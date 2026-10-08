import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, symlink, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Opt-in check: use the public prepared video, verified cache and actual packaged runtime.
const app = path.resolve(process.env.PAPAN_APP_DIR || '.');
const { openLibrary, newCollection } = await import(pathToFileURL(path.join(app, 'src/library.js')));
const { savePosePin } = await import(pathToFileURL(path.join(app, 'src/pose-pin.js')));
const { extractPose } = await import(pathToFileURL(path.join(app, 'src/pose.js')));
const artifacts = path.resolve('artifacts/pose-cleanup-live');
await mkdir(artifacts, { recursive: true });
const root = await mkdtemp(path.join(artifacts, 'profile-'));
let library;
try {
  const folder = randomUUID(), itemId = randomUUID();
  await mkdir(path.join(root, 'media', folder), { recursive: true });
  const file = path.join(root, 'media', folder, 'two-people.mp4');
  const ffmpeg = path.join(app, 'vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const created = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path.resolve('artifacts/pose-live/source.mp4'),
    '-filter_complex', '[0:v]split=2[a][b];[a][b]hstack=inputs=2[v]', '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', file]);
  assert.equal(created.status, 0, created.stderr?.toString());
  const original = await readFile(file), digest = bytes => createHash('sha256').update(bytes).digest('hex');
  library = await openLibrary(root);
  const collection = newCollection('cleanup check', { mode: 'offline' });
  const pin = { id: randomUUID(), title: 'public two-person cleanup fixture', sourceUrl: 'https://example.com/pose-cleanup', collectionId: collection.id,
    engine: 'page', offline: true, folder, notes: '', tags: [], coverId: itemId,
    items: [{ id: itemId, kind: 'video', localFile: `${folder}/two-people.mp4`, previewFile: `${folder}/two-people.mp4`, previewVersion: 1 }] };
  await library.mutate(draft => { draft.collections.push(collection); draft.pins.push(pin); });
  await library.mutate(draft => library.protection.setPassword(draft, collection.id, 'cleanup-check-password'));
  const sourceBefore = structuredClone(library.snapshot().pins[0].items[0]);
  await symlink(path.resolve('artifacts/pose-models'), path.join(root, 'pose-models'), 'junction');
  globalThis.fetch = () => { throw new Error('The packaged cleanup check must work offline.'); };
  const bytes = async item => {
    const descriptor = library.protection.media(item, true);
    return Buffer.concat(await Array.fromAsync(descriptor.stream(0, descriptor.size - 1)));
  };
  const runs = [];
  const dependencies = { library, changeLibrary: operation => library.mutate(operation), extract: async (...args) => {
    const result = await extractPose(...args); runs.push(result);
  } };
  const input = { id: pin.id, itemId, poseItemId: randomUUID() };
  let result = await savePosePin(input, dependencies, undefined, console.log);
  assert.ok(runs[0].maxPeople >= 2, 'The real detector sees multiple people in the fixture.');
  const allHash = digest(await bytes(result.item));
  for (const count of [1, 2]) {
    const options = { personCount: count, jointConfidence: 0.5 };
    const replacement = { ...input, poseItemId: result.item.id, poseTaskId: randomUUID(), replacePose: true, poseOptions: options };
    result = await savePosePin(replacement, dependencies, undefined, console.log);
    const run = runs.at(-1);
    assert.equal(run.maxPeople, count);
    assert.equal(run.frames, 51);
    assert.equal(result.item.id, input.poseItemId);
    assert.deepEqual(result.item.poseOptions, options);
    assert.deepEqual(result.pin.items[0], sourceBefore);
    assert.equal(result.pin.items.length, 2);
    assert.ok(result.item.vault);
    assert.equal(result.item.localFile, undefined);
    assert.equal(digest(await bytes(result.pin.items[0])), digest(original));
    const output = path.join(artifacts, `people-${count}.mp4`);
    await writeFile(output, await bytes(result.item));
    assert.notEqual(digest(await readFile(output)), allHash);
    const probe = spawnSync(path.join(app, 'vendor', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
      ['-v', 'error', '-show_entries', 'stream=codec_type,nb_frames,duration', '-of', 'json', output], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const { streams } = JSON.parse(probe.stdout);
    assert.equal(streams.length, 1); assert.equal(streams[0].codec_type, 'video');
    assert.equal(streams[0].nb_frames, '51'); assert.equal(streams[0].duration, '2.125000');
    await savePosePin(replacement, { ...dependencies, extract: () => { throw new Error('committed retry must not repeat inference'); } });
    assert.deepEqual(await readdir(path.join(root, 'staging')), []);
    assert.deepEqual(await readdir(path.join(root, 'media')), []);
  }
  await copyFile(library.protection.vaultPath(library.snapshot().collections[0]), path.join(artifacts, 'cleaned.papan'));
  await writeFile(path.join(artifacts, 'selection.json'), JSON.stringify({ pinId: pin.id, itemId: result.item.id, sourceId: itemId, password: 'cleanup-check-password' }));
  await writeFile(path.join(artifacts, 'check.json'), JSON.stringify({ status: 'passed', app, runtime: process.versions.electron ? `Electron ${process.versions.electron} Node mode` : process.version,
    runs, poseIdStable: true, sourceBytesAudioUnchanged: true, encryptedSettingsMedia: true, committedRetriesConverge: true, noPlaintextResidue: true,
    sourceFixture: 'https://github.com/Tau-J/rtmlib/blob/main/demo.jpg', limits: 'Stationary two-person fixture; no H3 generation, manual person selection, identity tracking through crossings or native window/IPC check.' }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', runs }));
} finally { library?.protection.clear(); await rm(root, { recursive: true, force: true }); }
