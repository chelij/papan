import { mkdtemp, mkdir, copyFile, symlink, readFile, writeFile, rm, link, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Opt-in inference check; prepared fixture and verified model cache required.
// PAPAN_APP_DIR selects packaged production code. No desktop window is opened.
const app = path.resolve(process.env.PAPAN_APP_DIR || '.');
const { openLibrary, newCollection } = await import(pathToFileURL(path.join(app, 'src/library.js')));
const { savePosePin } = await import(pathToFileURL(path.join(app, 'src/pose-pin.js')));
const { extractPose, poseSetup, POSE_MODELS } = await import(pathToFileURL(path.join(app, 'src/pose.js')));
const protectedMode = process.env.PAPAN_POSE_PROTECTED === '1';
const downloadMode = process.env.PAPAN_POSE_RUNTIME_DOWNLOAD === '1';
const data = await mkdtemp(path.resolve('artifacts/pose-live-pin-'));
let library, server, downloads = 0;
try {
  library = await openLibrary(data);
  const collection = newCollection('pose check', { mode: 'offline' }), folder = randomUUID(), itemId = randomUUID();
  await mkdir(path.join(data, 'media', folder));
  await copyFile('artifacts/pose-live/source.mp4', path.join(data, 'media', folder, 'source.mp4'));
  const cache = path.join(data, 'pose-models');
  if (downloadMode) {
    await mkdir(cache, { mode: 0o700 });
    for (const model of POSE_MODELS) await link(path.resolve('artifacts/pose-models', model.name), path.join(cache, model.name));
    const manifest = JSON.parse(await readFile(path.join(app, 'vendor/pose-runtime.json')));
    const runtimeFile = path.resolve('dist', new URL(manifest.url).pathname.split('/').at(-1));
    server = http.createServer((_request, response) => { downloads++; response.writeHead(200, { 'content-length': manifest.size }); createReadStream(runtimeFile).pipe(response); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = url => { assert.equal(url, manifest.url, 'model cache must not require a network download'); return nativeFetch(`http://127.0.0.1:${server.address().port}/runtime`); };
    const empty = path.join(data, 'not-created-until-confirmed'), setup = await poseSetup(empty);
    assert.equal(setup.downloadBytes, manifest.size + POSE_MODELS.reduce((sum, model) => sum + model.size, 0));
    assert.equal(downloads, 0, 'inspecting first-use requirements downloads nothing');
    await assert.rejects(stat(empty), { code: 'ENOENT' });
    const installedModels = await poseSetup(cache);
    assert.equal(installedModels.downloadBytes, manifest.size);
  } else {
    await symlink(path.resolve('artifacts/pose-models'), cache, 'junction');
    globalThis.fetch = () => { throw new Error('Live check must work offline without ComfyUI.'); };
  }
  const pin = { id: randomUUID(), title: 'pose live check', sourceUrl: 'https://example.com/pose-check', collectionId: collection.id,
    engine: 'page', notes: '', tags: [], coverId: itemId, folder, offline: true, createdAt: new Date().toISOString(),
    items: [{ id: itemId, kind: 'video', localFile: `${folder}/source.mp4`, previewFile: `${folder}/source.mp4`, previewVersion: 1 }] };
  await library.mutate(draft => { draft.collections.push(collection); draft.pins.push(pin); });
  const source = path.join(data, 'media', folder, 'source.mp4');
  const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  const before = await hash(source);
  if (protectedMode) await library.mutate(draft => library.protection.setPassword(draft, collection.id, 'pose-check-password'));
  const sourcePin = library.snapshot().pins[0];
  const mediaBytes = async item => {
    const descriptor = library.protection.media(item, true);
    return descriptor ? Buffer.concat(await Array.fromAsync(descriptor.stream(0, descriptor.size - 1))) : readFile(path.join(data, 'media', item.localFile));
  };
  let inference;
  const result = await savePosePin({ id: pin.id, itemId, poseItemId: randomUUID() }, { library, changeLibrary: operation => library.mutate(operation),
    extract: async (...args) => { inference = await extractPose(...args); } }, undefined, console.log);
  assert.equal(library.snapshot().pins.length, 1);
  assert.equal(result.pin.items.length, 2);
  assert.equal(result.item.poseFor, itemId);
  assert.equal(result.pin.title, 'pose live check');
  assert.deepEqual({ ...result.pin, items: result.pin.items.filter(item => !item.poseFor) }, sourcePin);
  assert.equal(createHash('sha256').update(await mediaBytes(sourcePin.items[0])).digest('hex'), before);
  const output = path.resolve(`artifacts/pose-live/${protectedMode ? 'protected-' : ''}result.mp4`);
  await writeFile(output, await mediaBytes(result.item));
  if (protectedMode) {
    assert.ok(result.item.vault);
    assert.equal(result.item.localFile, undefined);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(path.join(data, 'media')), []);
    assert.deepEqual(await readdir(path.join(data, 'staging')), []);
    for (const file of ['library.json', 'library.previous.json']) assert.equal((await readFile(path.join(data, file), 'utf8')).includes(pin.title), false);
    const collectionState = library.snapshot().collections[0];
    await copyFile(library.protection.vaultPath(collectionState), 'artifacts/pose-compatibility/protected-pose.papan');
    await writeFile('artifacts/pose-compatibility/protected-selection.json', JSON.stringify({ pinId: result.pin.id, itemId: result.item.id, password: 'pose-check-password', source: 'upstream demo image fixture, no user data' }));
  }
  const probe = spawnSync(path.join(app, 'vendor', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
    ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,nb_frames,r_frame_rate,duration', '-of', 'json', output], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const { streams } = JSON.parse(probe.stdout);
  assert.equal(streams.length, 1); assert.equal(streams[0].codec_type, 'video');
  assert.equal(streams[0].nb_frames, '51'); assert.equal(streams[0].duration, '2.125000');
  assert.deepEqual([streams[0].width, streams[0].height], [530, 640]);
  assert.equal(inference.frames, 51); assert.equal(inference.detectedFrames, 51);
  assert.equal((await poseSetup(cache)).downloadBytes, 0);
  if (downloadMode) {
    assert.equal(downloads, 1);
    // Retain only this public-fixture dependency cache for the subsequent offline check.
    const { readdir } = await import('node:fs/promises');
    await mkdir('artifacts/pose-models/runtime', { recursive: true });
    for (const name of await readdir(path.join(cache, 'runtime'))) await copyFile(path.join(cache, 'runtime', name), path.resolve('artifacts/pose-models/runtime', name));
  }
  const evidence = { status: 'passed', runtime: process.versions.electron ? `Electron ${process.versions.electron} Node mode` : process.version,
    app, protectedCollection: protectedMode, runtimeDownloadedOnDemand: downloadMode, runtimeRequests: downloads, inference, streams, sourceUnchanged: true, offline: !downloadMode,
    checks: ['actual packaged worker', protectedMode ? 'encrypted pose attachment commit and no plaintext residue' : 'ordinary pose attachment commit', 'original pin/media/audio unchanged', 'all 51 frames retained across batches', 'readable silent H.264', downloadMode ? 'read-only setup, then verified runtime download on confirmation' : 'no network/server required'],
    limits: `Linux only, fixture from upstream demo image.${downloadMode ? ' Runtime delivery used a loopback fixture serving the real release asset, with models already cached; public GitHub asset availability was not checked.' : ''} Native Electron window/IPC and H3 generation were not exercised.` };
  await writeFile(`artifacts/pose-live/${downloadMode ? 'on-demand-' : ''}${protectedMode ? 'protected-' : ''}packaged-check.json`, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { library?.protection.clear(); await rm(data, { recursive: true, force: true }); if (server) await new Promise(resolve => server.close(resolve)); }
