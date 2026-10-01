import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
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
let fixture, receiver, installed = false, tunnel = false, port, saves = 0;
const artifactDir = path.resolve('artifacts/android/ui'); await mkdir(artifactDir, { recursive: true });
try {
  fixture = await startFixture();
  const library = await openLibrary(root), destination = newCollection('Android test inbox');
  await library.mutate(draft => draft.collections.push(destination));
  const reserving = createServer(); await new Promise(resolve => reserving.listen(0, '127.0.0.1', resolve));
  port = reserving.address().port; await new Promise(resolve => reserving.close(resolve));
  receiver = await openPhoneReceiver(root, {
    addresses: () => [{ name: 'USB test', address: '127.0.0.1' }], collection: id => library.requireUnlocked(id),
    run: (task, signal, progress) => savePhoneLink(task, {
      snapshot: library.snapshot, requireUnlocked: id => library.requireUnlocked(id), inspect: inspectLink,
      save: async ({ pin }, signal) => {
        // Force an initial pending receipt, proving foreground polling observes completion.
        await new Promise(resolve => setTimeout(resolve, 2500)); signal.throwIfAborted();
        const saved = await materialize(pin, root, false, signal); await library.mutate(draft => draft.pins.push(saved)); saves++; return { pin: saved };
      },
    }, signal, progress),
  });
  await receiver.configure({ enabled: true, host: '127.0.0.1', port, collectionId: destination.id });
  const pairing = await receiver.pair();
  adb('install', '-r', path.join(androidRoot, 'dist', `Papan-Android-${androidVersion}-test.apk`)); installed = true;
  adb('shell', 'pm', 'grant', packageName, 'android.permission.CAMERA');
  adb('reverse', `tcp:${port}`, `tcp:${port}`); tunnel = true;
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.env.PAPAN_ADB, [...adbArgs, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'pairLink', quote(pairing.url), '-e', 'shareUrl', quote(`${fixture.url}/wide.png`), '-e', 'cameraOnly', String(cameraOnly), `${packageName}/com.papan.share.MobileFlowTest`]);
    let out = ''; child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { out += data; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Android instrumentation timed out.')); }, 90000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve(out) : reject(new Error(`Instrumentation exited ${code}: ${out}`)); });
  });
  await writeFile(path.join(artifactDir, 'instrumentation.txt'), output);
  for (const name of ['unpaired.png', 'paired.png']) {
    const result = spawnSync(process.env.PAPAN_ADB, [...adbArgs, 'exec-out', 'run-as', packageName, 'cat', `files/${name}`], { timeout: 30000 });
    if (result.status === 0) await writeFile(path.join(artifactDir, name), result.stdout);
  }
  assert.match(output, /INSTRUMENTATION_RESULT: status=passed/, output);
  assert.equal(saves, 1, 'One pasted URL should produce exactly one save.');
  assert.equal(library.snapshot().pins.length, 1); assert.equal(library.snapshot().pins[0].collectionId, destination.id);
  assert.ok(library.snapshot().pins[0].items[0].previewFile, 'Actual saved media must have a preview.');
  assert.equal(receiver.snapshot().entries[0].state, 'saved');
  const checks = output.match(/INSTRUMENTATION_RESULT: checks=(.+)/)?.[1];
  await writeFile(path.join(artifactDir, 'report.json'), JSON.stringify({ status: 'passed', clipboard: !cameraOnly, device: process.env.PAPAN_ANDROID_SERIAL || 'connected Android', displayId: Number(output.match(/displayId=(\d+)/)?.[1]), transport: 'USB reverse; Wi-Fi reachability not tested', saves, checks, cameraLimit: 'Live Camera2 frames and rotated QR fixtures verified separately; optical scan of desktop screen not exercised.' }, null, 2) + '\n');
  console.log(checks); console.log('Real receiver saved one image into the disposable collection.');
} finally {
  if (installed) adb('uninstall', packageName);
  if (tunnel) adb('reverse', '--remove', `tcp:${port}`);
  await receiver?.stop(); await fixture?.close(); await rm(root, { recursive: true, force: true });
}
