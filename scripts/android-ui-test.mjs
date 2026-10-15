import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHTTPServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { openPhoneReceiver } from '../src/phone-receiver.js';
import { savePhoneLink } from '../src/phone-save.js';
import { openLibrary, newCollection } from '../src/library.js';
import { inspectLink, materialize } from '../src/media.js';
import { startFixture } from '../test/fixture.js';

// Separate APK, real receiver/extraction, temporary library, USB tunnel, virtual display.
assert.ok(process.env.PAPAN_ADB, 'Set PAPAN_ADB to the adb executable.');
const packageName = 'com.papan.share.test';
const cameraOnly = process.env.PAPAN_ANDROID_CAMERA_ONLY === '1';
const androidRoot = path.resolve(process.env.PAPAN_ANDROID_DIR || '../papan-android');
const androidVersion = JSON.parse(await readFile(path.join(androidRoot, 'package.json'), 'utf8')).version;
const adbArgs = process.env.PAPAN_ANDROID_SERIAL ? ['-s', process.env.PAPAN_ANDROID_SERIAL] : [];
const adb = (...args) => {
  const result = spawnSync(process.env.PAPAN_ADB, [...adbArgs, ...args], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
};
assert.equal(adb('shell', 'pm', 'list', 'packages', packageName).trim(), '', 'Remove only the disposable test package before running again.');
const root = await mkdtemp(path.join(os.tmpdir(), 'papan-android-ui-'));
let fixture, receiver, pairingReceiver, control, installed = false, port, reconnectPort, pairingPort, saves = 0;
const tunnels = [];
const artifactDir = path.resolve('artifacts/android/ui'); await mkdir(artifactDir, { recursive: true });
const screens = ['failure.png', 'local.png', 'remote.png', 'video-board.png', 'failed-board.png', 'unpaired.png', 'paired.png', 'nearby-pairing.png', 'connections-feedback.png', 'connections-large-text.png', 'narrow.png', 'tablet.png', 'large-text.png', 'style-small.png', 'style-large.png', 'style-light.png', 'style-dark.png', 'style-appearance.png', 'style-large-text.png'];
for (const name of ['report.json', 'instrumentation.txt', ...screens]) await rm(path.join(artifactDir, name), { force: true });
try {
  fixture = await startFixture();
  const library = await openLibrary(root), destination = newCollection('Android test inbox'), chosen = newCollection('Android chosen'), protectedBoard = newCollection('Protected test'), many = newCollection('Many references');
  await library.mutate(draft => { draft.collections.push(destination, chosen, protectedBoard, many, { ...newCollection('Closed test'), closed: true }); draft.pins.push(...Array.from({ length: 85 }, (_, index) => { const itemId = randomUUID(); return { id: randomUUID(), collectionId: many.id, title: 'Fixture reference ' + index, sourceUrl: `https://example.com/fixture/${index}`, notes: '', tags: [], engine: 'page', offline: false, coverId: itemId, items: [{ id: itemId, kind: 'text', text: 'Pagination fixture' }] }; })); });
  const signal = new AbortController().signal, data = await inspectLink(`${fixture.url}/portrait.mp4`, signal), items = data.items.map(item => ({ ...item, id: randomUUID() }));
  const seed = await materialize({ id: randomUUID(), collectionId: protectedBoard.id, sourceUrl: data.sourceUrl, engine: data.engine, title: 'Protected reference', notes: '', tags: [], items, coverId: items[0].id, createdAt: new Date().toISOString() }, root, false, signal);
  await library.mutate(draft => draft.pins.push(seed));
  await library.mutate(draft => library.protection.setPassword(draft, protectedBoard.id, 'mobile-test-password'));
  const reserving = createServer(); await new Promise(resolve => reserving.listen(0, '127.0.0.1', resolve));
  port = reserving.address().port; await new Promise(resolve => reserving.close(resolve));
  receiver = await openPhoneReceiver(root, {
    library, unlock: (id, password) => library.mutate(draft => library.protection.unlock(draft, id, password)),
    addresses: () => [{ name: 'USB test', address: '127.0.0.1' }], collection: id => library.requireUnlocked(id),
    codec: { encode: (task, data) => library.protection.encodeTask(task, data || library.snapshot()), decode: task => library.protection.decodeTask(task) },
    run: (task, signal, progress) => savePhoneLink(task, {
      snapshot: library.snapshot, requireUnlocked: id => library.requireUnlocked(id), inspect: inspectLink,
      save: async ({ pin }, signal) => {
        // Force an initial pending receipt, proving foreground polling observes completion.
        await new Promise(resolve => setTimeout(resolve, 2500)); signal.throwIfAborted();
        const saved = await materialize(pin, root, false, signal); await library.mutate(draft => draft.pins.push(saved)); saves++; return { pin: saved };
      },
    }, signal, progress),
  });
  const settings = { enabled: true, browsing: true, host: '127.0.0.1', port, collectionId: destination.id };
  await receiver.configure(settings);
  const unusedPort = async () => { const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const value = socket.address().port; await new Promise(resolve => socket.close(resolve)); return value; };
  reconnectPort = await unusedPort(); pairingPort = await unusedPort();
  const pairingRoot = path.join(root, 'nearby'); await mkdir(pairingRoot);
  const pairingLibrary = await openLibrary(pairingRoot), pairingCollection = newCollection('Nearby inbox');
  await pairingLibrary.mutate(draft => draft.collections.push(pairingCollection));
  pairingReceiver = await openPhoneReceiver(pairingRoot, { addresses: () => [{ name: 'USB test', address: '127.0.0.1' }], library: pairingLibrary, unlock: async (id, password) => pairingLibrary.mutate(draft => pairingLibrary.protection.unlock(draft, id, password)), collection: () => {}, run: async () => ({}) });
  await pairingReceiver.configure({ enabled: true, browsing: true, host: '127.0.0.1', port: pairingPort, collectionId: pairingCollection.id });
  control = createHTTPServer(async (request, response) => {
    try {
      let result = {};
      if (request.method !== 'POST') throw new Error('Use POST.');
      if (request.url === '/disable') await receiver.configure({ ...settings, enabled: false });
      else if (request.url === '/enable') await receiver.configure(settings);
      else if (request.url === '/move') { settings.port = reconnectPort; await receiver.configure(settings); }
      else if (request.url === '/approve-pairing') { const pending = pairingReceiver.snapshot().pairingRequests[0]; assert.ok(pending); await pairingReceiver.approvePairRequest(pending.id); }
      else if (request.url === '/lock') await library.mutate(draft => library.protection.lock(draft, protectedBoard.id));
      else throw new Error('Unknown test control.');
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
    } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
  const pairing = await receiver.pair();
  adb('install', '-r', path.join(androidRoot, 'dist', `Papan-Android-${androidVersion}-test.apk`)); installed = true;
  if (process.env.PAPAN_ANDROID_DEMO_ROOT && !cameraOnly) {
    const demoRoot = path.resolve(process.env.PAPAN_ANDROID_DEMO_ROOT), catalog = JSON.parse(await readFile(path.join(demoRoot, 'docs/demo/catalog.json'), 'utf8'));
    const samples = catalog.slice(0, 8).map(art => {
      assert.equal(art.isPublicDomain, true, 'Use only the existing credited public-domain demo.');
      assert.ok(Number.isSafeInteger(art.objectID));
      return { sourceUrl: art.objectURL, title: art.title, objectID: art.objectID, mediaFile: `${randomUUID()}.jpg` };
    });
    adb('shell', 'run-as', packageName, 'mkdir', '-p', 'files/mobile-media');
    const put = (name, bytes) => {
      assert.match(name, /^(?:style-demo\.json|mobile-media\/[a-f0-9-]{36}\.jpg)$/);
      const result = spawnSync(process.env.PAPAN_ADB, [...adbArgs, 'shell', '-T', 'run-as', packageName, 'sh', '-c', `'cat > files/${name}'`], { input: bytes, timeout: 30000 });
      assert.equal(result.status, 0, result.stderr.toString());
    };
    for (const sample of samples) put(`mobile-media/${sample.mediaFile}`, await readFile(path.join(demoRoot, 'artifacts/demo', `${sample.objectID}.jpg`)));
    put('style-demo.json', Buffer.from(JSON.stringify(samples)));
  }
  adb('shell', 'pm', 'grant', packageName, 'android.permission.CAMERA');
  for (const tunnelPort of [port, reconnectPort, pairingPort, new URL(fixture.url).port, control.address().port]) { adb('reverse', `tcp:${tunnelPort}`, `tcp:${tunnelPort}`); tunnels.push(tunnelPort); }
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.env.PAPAN_ADB, [...adbArgs, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'pairLink', quote(pairing.url), '-e', 'shareUrl', quote(`${fixture.url}/wide.png`), '-e', 'controlEndpoint', quote(`http://127.0.0.1:${control.address().port}`), '-e', 'pairEndpoint', quote(`http://127.0.0.1:${pairingPort}`), '-e', 'pairServerId', pairingReceiver.snapshot().serverId, '-e', 'reconnectEndpoint', quote(`http://127.0.0.1:${reconnectPort}`), '-e', 'cameraOnly', String(cameraOnly), `${packageName}/com.papan.share.MobileFlowTest`]);
    let out = ''; child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { out += data; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Android instrumentation timed out.')); }, 240000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve(out) : reject(new Error(`Instrumentation exited ${code}: ${out}`)); });
  });
  await writeFile(path.join(artifactDir, 'instrumentation.txt'), output);
  for (const name of screens) {
    const result = spawnSync(process.env.PAPAN_ADB, [...adbArgs, 'exec-out', 'run-as', packageName, 'cat', `files/${name}`], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status === 0 && result.stdout.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) await writeFile(path.join(artifactDir, name), result.stdout);
  }
  assert.match(output, /INSTRUMENTATION_RESULT: status=passed/, output);
  if (!cameraOnly) for (const name of ['nearby-pairing.png', 'connections-feedback.png', 'connections-large-text.png']) assert.ok((await readFile(path.join(artifactDir, name))).length > 1000, `Native pairing/feedback capture missing: ${name}`);
  if (process.env.PAPAN_ANDROID_DEMO_ROOT && !cameraOnly) for (const name of screens.filter(name => name.startsWith('style-'))) assert.ok((await readFile(path.join(artifactDir, name))).length > 1000, `Native screenshot missing: ${name}`);
  assert.equal(saves, cameraOnly ? 1 : 3, 'Every chosen desktop destination should produce exactly one save.');
  assert.equal(library.snapshot().pins.filter(pin => pin.collectionId === destination.id).length, 1);
  if (!cameraOnly) assert.equal(library.snapshot().pins.filter(pin => pin.collectionId === chosen.id).length, 1);
  if (!cameraOnly) {
    assert.equal(library.protection.isUnlocked(protectedBoard.id), false, 'Native lock should leave the protected desktop collection locked.');
    await library.mutate(draft => library.protection.unlock(draft, protectedBoard.id, 'mobile-test-password'));
    assert.equal(library.snapshot().pins.filter(pin => pin.collectionId === protectedBoard.id).length, 2);
  }
  assert.ok(library.snapshot().pins.find(pin => pin.collectionId === destination.id).items[0].previewFile, 'Actual saved media must have a preview.');
  assert.equal(receiver.snapshot().entries[0].state, 'saved');
  const checks = output.match(/INSTRUMENTATION_RESULT: checks=(.+)/)?.[1];
  await writeFile(path.join(artifactDir, 'report.json'), JSON.stringify({ status: 'passed', clipboard: !cameraOnly, device: process.env.PAPAN_ANDROID_SERIAL || 'connected Android', displayId: Number(output.match(/displayId=(\d+)/)?.[1]), transport: 'ADB reverse; Wi-Fi reachability not tested', saves, checks, cameraLimit: 'Live Camera2 frames and rotated QR fixtures verified separately; optical scan of desktop screen not exercised.' }, null, 2) + '\n');
  console.log(checks); console.log(`Real receiver saved ${saves} images into the chosen disposable collections.`);
} finally {
  if (installed) adb('uninstall', packageName);
  for (const tunnelPort of tunnels) adb('reverse', '--remove', `tcp:${tunnelPort}`);
  await receiver?.stop(); await pairingReceiver?.stop(); if (control) await new Promise(resolve => { control.close(resolve); control.closeAllConnections(); }); await fixture?.close(); await rm(root, { recursive: true, force: true });
}
