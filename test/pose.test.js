import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { ensurePoseModels, ensurePoseRuntime, poseWorker } from '../src/pose.js';
import { createHash } from 'node:crypto';
import { poseSource, savePosePin } from '../src/pose-pin.js';
import { openLibrary, newCollection, pinPreviews } from '../src/library.js';
import { mediaLocation, saveCollectionFile, readCollectionFile, validateContents } from '../src/collection-files.js';
import { preparePoseSegments, combinePoseSegments, materialize } from '../src/media.js';
import { exportBundle, importBundle } from '../src/portable.js';
import { openDownloadQueue } from '../src/download-queue.js';

const controller = () => new AbortController();

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-pose-')), library = await openLibrary(root);
  const collection = newCollection('motion references', { mode: 'offline' }), folder = randomUUID(), itemId = randomUUID();
  await mkdir(path.join(root, 'media', folder));
  await copyFile('test/media/portrait.mp4', path.join(root, 'media', folder, 'video.mp4'));
  const pin = { id: randomUUID(), title: 'source movement', engine: 'page', collectionId: collection.id, coverId: itemId, sourceUrl: 'https://example.com/source',
    offline: true, folder, notes: 'keep this', tags: ['dance'], items: [{ id: itemId, kind: 'video', previewVersion: 1, previewFile: `${folder}/video.mp4`, localFile: `${folder}/video.mp4` }] };
  await library.mutate(draft => { draft.collections.push(collection); draft.pins.push(pin); });
  return { root, library, pin, collection, input: { id: pin.id, itemId, poseItemId: randomUUID() },
    changeLibrary: operation => library.mutate(operation), extract: (file, stage) => copyFile(file, path.join(stage, 'pose.mp4')) };
}

test('pose model cache verifies hashes, repairs corruption and rejects incomplete downloads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-pose-models-'));
  const contents = Buffer.from('verified ONNX fixture'), model = { name: 'pose.onnx', url: 'https://example.com/model', size: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex') };
  let calls = 0;
  const options = { models: [model], fetchImpl: async () => { calls++; return new Response(contents); } };
  try {
    const [file] = await ensurePoseModels(root, undefined, () => {}, options);
    assert.deepEqual(await readFile(file), contents);
    await ensurePoseModels(root, undefined, () => {}, options);
    assert.equal(calls, 1, 'valid cache works offline');
    await writeFile(file, 'corrupt');
    await ensurePoseModels(root, undefined, () => {}, options);
    assert.equal(calls, 2);
    await rm(file);
    await assert.rejects(ensurePoseModels(root, undefined, () => {}, { ...options, fetchImpl: async () => new Response('partial') }), /incomplete or corrupted/);
    assert.deepEqual(await readdir(root), []);
    const abort = controller();
    await assert.rejects(ensurePoseModels(root, abort.signal, message => { if (message.includes('%')) abort.abort(); }, options));
    assert.deepEqual(await readdir(root), [], 'cancelled download leaves no partial cache');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local pose worker reports progress and failures without a server', async () => {
  const progress = [], options = { command: process.execPath, args: ['-e', `
    process.stdin.resume();
    console.log(JSON.stringify({progress:'extracting local frames'}));
    console.log(JSON.stringify({ok:true,result:{frames:48,detectedFrames:47}}));`] };
  assert.deepEqual(await poseWorker({}, undefined, message => progress.push(message), options), { frames: 48, detectedFrames: 47 });
  assert.deepEqual(progress, ['extracting local frames']);
  await assert.rejects(poseWorker({}, undefined, () => {}, { ...options, args: ['-e', `console.log(JSON.stringify({ok:false,error:'No clear human pose was found.'})); process.exit(1);`] }), /No clear human pose/);
  await assert.rejects(poseWorker({}, undefined, () => {}, { ...options, args: ['-e', `console.log('invalid worker output');`] }), /invalid response/);
});

test('cancelling local pose work stops its process before the task finishes', async () => {
  const abort = controller();
  let pid;
  const task = poseWorker({}, abort.signal, message => { pid = Number(message); abort.abort(); }, {
    command: process.execPath, args: ['-e', `console.log(JSON.stringify({progress:String(process.pid)})); setInterval(()=>{},1000);`],
  });
  await assert.rejects(task, /Cancelled/);
  assert.ok(pid);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

function videoInfo(file) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-vf', 'showinfo', '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { frames: [...result.stderr.matchAll(/Parsed_showinfo[^\n]*\bn:\s*(\d+)\s/g)].length,
    size: result.stderr.match(/Video:.*?, (\d+x\d+)[ ,]/)?.[1], hasAudio: /Stream.*Audio:/.test(result.stderr) };
}

test('real FFmpeg batching preserves every frame, duration and aspect ratio across joins', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-pose-frames-')), stage = path.join(root, 'staging'), source = path.join(root, 'source.mp4');
  try {
    await mkdir(stage);
    const created = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=720x1280:r=24', '-t', '5.75', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source]);
    assert.equal(created.status, 0, created.stderr?.toString());
    const before = await readFile(source), segments = await preparePoseSegments(source, stage);
    assert.equal(segments.length, 3);
    assert.deepEqual(segments.map(file => videoInfo(file).frames), [48, 48, 42]);
    // Use the prepared clips as output fixtures to exercise actual joining,
    // without claiming that a stub performs pose inference.
    for (const [index, file] of segments.entries()) await copyFile(file, path.join(stage, `pose-${String(index).padStart(5, '0')}.mp4`));
    const output = await combinePoseSegments(stage, segments.length);
    assert.deepEqual(videoInfo(output), { frames: 138, size: '406x720', hasAudio: false });
    assert.deepEqual(await readFile(source), before);
    assert.deepEqual(await readdir(stage), ['pose.mp4']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('pose is attached to its source pin, survives saved/portable collections, and retries converge', async () => {
  const f = await fixture();
  try {
    const result = await savePosePin(f.input, f);
    assert.equal(result.pin.id, f.pin.id);
    assert.equal(result.item.poseFor, f.input.itemId);
    assert.equal(result.pin.coverId, f.pin.coverId);
    assert.equal(result.item.url, undefined);
    assert.deepEqual({ ...result.pin, items: result.pin.items.filter(item => !item.poseFor) }, f.pin, 'original pin contents are unchanged');
    assert.deepEqual(await readFile(mediaLocation(f.root, result.item, true)), await readFile('test/media/portrait.mp4'));
    await savePosePin(f.input, { ...f, extract: () => { throw new Error('should not extract twice'); } });
    assert.equal(f.library.snapshot().pins.length, 1);
    assert.equal(f.library.snapshot().pins[0].items.length, 2);
    const collection = { ...f.collection, destination: path.join(f.root, 'motion.papan') };
    await saveCollectionFile(f.root, f.library.snapshot(), collection);
    const loaded = await readCollectionFile(collection.destination, { collections: [], pins: [] });
    assert.equal(JSON.parse(await readFile(collection.destination)).pins[0].id, result.pin.id);
    assert.equal(loaded.pins[0].title, result.pin.title);
    assert.deepEqual(await readFile(mediaLocation(f.root, loaded.pins[0].items[1], true)), await readFile('test/media/portrait.mp4'));
    const bundle = path.join(f.root, 'motion.papan.zip');
    await exportBundle(f.root, f.library.snapshot(), f.collection, bundle);
    const imported = await importBundle(f.root, bundle);
    assert.equal(imported.pins[0].title, result.pin.title);
    assert.deepEqual(await readFile(mediaLocation(f.root, imported.pins[0].items[1], true)), await readFile('test/media/portrait.mp4'));
    const rebuilt = await materialize(result.pin, f.root, true);
    assert.deepEqual(await readFile(mediaLocation(f.root, rebuilt.items[1], true)), await readFile('test/media/portrait.mp4'), 'local-only pose media never re-downloads the source post');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('failed extraction, cancelled work and a removed source leave no result or staging media', async () => {
  const f = await fixture();
  try {
    const folders = await readdir(path.join(f.root, 'media'));
    for (const mode of ['failed', 'cancelled', 'removed']) {
      const abort = controller();
      await assert.rejects(savePosePin(f.input, { ...f, extract: async (file, stage) => {
        await copyFile(file, path.join(stage, 'pose.mp4'));
        if (mode === 'failed') throw new Error('pose failure');
        if (mode === 'cancelled') abort.abort();
        if (mode === 'removed') await f.changeLibrary(draft => { draft.pins = []; });
      } }, abort.signal));
      assert.deepEqual(await readdir(path.join(f.root, 'media')), folders);
      assert.deepEqual(await readdir(path.join(f.root, 'staging')), []);
      assert.equal(f.library.snapshot().pins.some(pin => pin.items.some(item => item.poseFor === f.input.itemId)), false);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('pose cleanup safely replaces the attachment in place, saves settings and converges on retry', async () => {
  for (const protectedMode of [false, true]) {
    const f = await fixture();
    try {
      if (protectedMode) await f.changeLibrary(draft => f.library.protection.setPassword(draft, f.collection.id, 'cleanup-password'));
      const first = await savePosePin(f.input, f), previous = structuredClone(first.item), source = structuredClone(first.pin.items[0]);
      const input = { ...f.input, poseItemId: first.item.id, poseTaskId: randomUUID(), replacePose: true, poseOptions: { personCount: 1, jointConfidence: 0.7 } };
      for (const mode of ['failed', 'cancelled', 'commit failed']) {
        const abort = controller();
        await assert.rejects(savePosePin(input, { ...f, extract: async (file, stage) => {
          await copyFile(file, path.join(stage, 'pose.mp4'));
          if (mode === 'failed') throw new Error('extraction failed');
          if (mode === 'cancelled') abort.abort();
        }, ...(mode === 'commit failed' ? { changeLibrary: () => { throw new Error('save failed'); } } : {}) }, abort.signal));
        assert.deepEqual(f.library.snapshot().pins[0].items[1], previous, 'old pose survives interrupted/failed replacement');
        assert.deepEqual(await readdir(path.join(f.root, 'staging')), []);
      }
      let runs = 0;
      const result = await savePosePin(input, { ...f, extract: async (file, stage, cache, signal, progress, options) => {
        runs++;
        assert.deepEqual(options, input.poseOptions);
        await copyFile(file, path.join(stage, 'pose.mp4'));
        await writeFile(path.join(stage, 'pose.mp4'), Buffer.concat([await readFile(path.join(stage, 'pose.mp4')), Buffer.from('replacement fixture marker')]));
      } });
      assert.equal(result.item.id, previous.id);
      assert.equal(result.pin.items.length, 2);
      assert.deepEqual(result.pin.items[0], source);
      assert.deepEqual(result.item.poseOptions, input.poseOptions);
      assert.equal(result.item.poseTaskId, input.poseTaskId);
      assert.notDeepEqual(result.item, previous);
      await savePosePin(input, { ...f, extract: () => { throw new Error('already committed retry must not extract again'); } });
      assert.equal(runs, 1);
      if (protectedMode) {
        assert.ok(result.item.vault);
        assert.equal(result.item.localFile, undefined);
        assert.ok((await decryptedVideo(f.library, result.item)).includes(Buffer.from('replacement fixture marker')));
        const disk = await readFile(path.join(f.root, 'library.json'), 'utf8');
        assert.equal(disk.includes('poseOptions'), false);
        assert.deepEqual(await readdir(path.join(f.root, 'media')), []);
        f.library.protection.clear();
        const reopened = await openLibrary(f.root);
        await reopened.mutate(draft => reopened.protection.unlock(draft, f.collection.id, 'cleanup-password'));
        assert.deepEqual(reopened.snapshot().pins[0].items[1].poseOptions, input.poseOptions);
        reopened.protection.clear();
      } else {
        assert.ok((await readFile(mediaLocation(f.root, result.item, true))).includes(Buffer.from('replacement fixture marker')));
        const destination = path.join(f.root, 'cleanup.papan');
        await saveCollectionFile(f.root, f.library.snapshot(), { ...f.collection, destination });
        const loaded = await readCollectionFile(destination, { collections: [], pins: [] });
        assert.deepEqual(loaded.pins[0].items[1].poseOptions, input.poseOptions);
        assert.equal(loaded.pins[0].items[1].id, previous.id);
      }
    } finally { f.library.protection.clear(); await rm(f.root, { recursive: true, force: true }); }
  }
});

test('pose cleanup rejects invalid settings, changed attachments and invalid replacement requests', async () => {
  const f = await fixture();
  try {
    for (const options of [{}, { personCount: 'one', jointConfidence: 0.3 }, { personCount: 1, jointConfidence: NaN }, { personCount: 1, jointConfidence: 1 }]) {
      assert.throws(() => poseSource(f.library, { ...f.input, poseOptions: options }), /Invalid pose cleanup/);
    }
    const first = await savePosePin(f.input, f);
    await assert.rejects(savePosePin({ ...f.input, replacePose: true }, f), /pose attachment changed/);
    const input = { ...f.input, replacePose: true, poseTaskId: randomUUID(), poseOptions: { personCount: 1, jointConfidence: 0.5 } };
    await assert.rejects(savePosePin(input, { ...f, extract: async (file, stage) => {
      await copyFile(file, path.join(stage, 'pose.mp4'));
      await f.changeLibrary(draft => { draft.pins[0].items[1].poseTaskId = randomUUID(); });
    } }), /pose attachment changed/);
    assert.equal(f.library.snapshot().pins[0].items[1].id, first.item.id);
    assert.deepEqual(await readdir(path.join(f.root, 'staging')), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('derived pose video can be encrypted and repaired locally', async () => {
  const f = await fixture();
  try {
    const result = await savePosePin(f.input, f);
    await f.changeLibrary(draft => f.library.protection.setPassword(draft, f.collection.id, 'pose-test-password'));
    assert.equal(typeof poseSource(f.library, f.input).file.stream, 'function');
    const encrypted = f.library.snapshot().pins.find(pin => pin.id === result.pin.id);
    assert.ok(encrypted.items[1].vault);
    const rebuilt = await materialize(encrypted, f.root, true, undefined, () => {}, '', item => f.library.protection.media(item, true));
    assert.deepEqual(await readFile(mediaLocation(f.root, rebuilt.items[1], true)), await readFile('test/media/portrait.mp4'));
    await f.changeLibrary(draft => Object.assign(draft.pins.find(pin => pin.id === encrypted.id), { items: rebuilt.items, folder: rebuilt.folder }));
    const repaired = f.library.snapshot().pins.find(pin => pin.id === encrypted.id);
    assert.ok(repaired.items[1].vault);
    assert.equal(repaired.items[1].localFile, undefined);
    assert.equal((await readdir(path.join(f.root, 'media'))).includes(rebuilt.folder), false, 'committing a local repair removes plaintext staging copies');
  } finally { f.library.protection.clear(); await rm(f.root, { recursive: true, force: true }); }
});

async function decryptedVideo(library, item) {
  const media = library.protection.media(item, true);
  return Buffer.concat(await Array.fromAsync(media.stream(0, media.size - 1)));
}

test('unlocked protected video gains an encrypted pose attachment with private temporary input and no plaintext residue', async () => {
  const f = await fixture(), password = 'pose-test-password';
  try {
    const bytes = await readFile('test/media/portrait.mp4');
    // The original must be chosen even when its display preview is different.
    const preview = `${f.pin.folder}/reduced.mp4`;
    await writeFile(path.join(f.root, 'media', preview), 'reduced display preview');
    await f.changeLibrary(draft => { draft.pins[0].items[0].previewFile = preview; });
    await f.changeLibrary(draft => f.library.protection.setPassword(draft, f.collection.id, password));
    const original = f.library.snapshot().pins[0];
    let privateFile;
    const result = await savePosePin(f.input, { ...f, extract: async (file, stage) => {
      privateFile = file;
      assert.equal(path.dirname(file), stage);
      if (process.platform !== 'win32') {
        assert.equal((await stat(file)).mode & 0o777, 0o600);
        assert.equal((await stat(stage)).mode & 0o777, 0o700);
      }
      assert.deepEqual(await readFile(file), bytes);
      await copyFile(file, path.join(stage, 'pose.mp4'));
    } });
    assert.ok(result.item.vault);
    assert.equal(result.item.localFile, undefined);
    assert.equal(result.pin.folder, undefined);
    assert.equal(result.pin.items.length, 2);
    assert.deepEqual({ ...result.pin, items: result.pin.items.filter(item => !item.poseFor) }, original);
    assert.deepEqual(await decryptedVideo(f.library, result.item), bytes);
    assert.deepEqual(await readdir(path.join(f.root, 'media')), []);
    assert.deepEqual(await readdir(path.join(f.root, 'staging')), []);
    await assert.rejects(readFile(privateFile), { code: 'ENOENT' });
    for (const file of ['library.json', 'library.previous.json']) {
      const disk = await readFile(path.join(f.root, file), 'utf8');
      assert.equal(disk.includes('source movement'), false);
      assert.equal(disk.includes('https://example.com/source'), false);
    }
    await f.changeLibrary(draft => f.library.protection.lock(draft, f.collection.id));
    await assert.rejects(savePosePin(f.input, f), /Pin not found|Unlock/);
    await f.changeLibrary(draft => f.library.protection.unlock(draft, f.collection.id, password));
    await savePosePin(f.input, { ...f, extract: () => { throw new Error('must not repeat committed extraction'); } });
    assert.equal(f.library.snapshot().pins.length, 1);
    assert.equal(f.library.snapshot().pins[0].items.length, 2);
    const reopened = await openLibrary(f.root);
    try {
      assert.equal(reopened.publicSnapshot().collections[0].locked, true);
      assert.deepEqual(reopened.snapshot().pins, []);
      await reopened.mutate(draft => reopened.protection.unlock(draft, f.collection.id, password));
      const pose = reopened.snapshot().pins.find(pin => pin.id === result.pin.id);
      assert.deepEqual(await decryptedVideo(reopened, pose.items[1]), bytes);
    } finally { reopened.protection.clear(); }
  } finally { f.library.protection.clear(); await rm(f.root, { recursive: true, force: true }); }
});

test('protected decryption, extraction, cancellation and commit failures clean up without altering the source vault', async () => {
  for (const mode of ['decrypt-cancel', 'failed', 'cancelled', 'commit-failed']) {
    const f = await fixture(), abort = controller();
    try {
      await f.changeLibrary(draft => f.library.protection.setPassword(draft, f.collection.id, 'pose-test-password'));
      const before = f.library.snapshot(), vault = f.library.protection.vaultPath(before.collections[0]), bytes = await readFile(vault);
      let started = false;
      if (mode === 'decrypt-cancel') {
        const media = f.library.protection.media;
        f.library.protection.media = (...args) => {
          const source = media(...args);
          return { ...source, stream: async function* (...range) { for await (const chunk of source.stream(...range)) { abort.abort(); yield chunk; } } };
        };
      }
      await assert.rejects(savePosePin(f.input, { ...f,
        changeLibrary: mode === 'commit-failed' ? operation => f.library.mutate(operation, async () => {}, async () => { throw new Error('destination unavailable'); }) : f.changeLibrary,
        extract: async (file, stage) => {
          started = true;
          await copyFile(file, path.join(stage, 'pose.mp4'));
          if (mode === 'failed') throw new Error('inference failed');
          if (mode === 'cancelled') abort.abort();
        },
      }, abort.signal));
      assert.equal(started, mode !== 'decrypt-cancel');
      assert.deepEqual(f.library.snapshot(), before);
      assert.deepEqual(await readFile(vault), bytes);
      assert.deepEqual(await readdir(path.join(f.root, 'media')), []);
      assert.deepEqual(await readdir(path.join(f.root, 'staging')), []);
    } finally { f.library.protection.clear(); await rm(f.root, { recursive: true, force: true }); }
  }
});

test('protected pose queue encrypts its details, requires unlocking to retry, and commits only one encrypted result', async () => {
  const f = await fixture(), password = 'pose-test-password';
  let queue;
  try {
    await f.changeLibrary(draft => f.library.protection.setPassword(draft, f.collection.id, password));
    let first = true, ready;
    const started = new Promise(resolve => { ready = resolve; });
    const codec = { encode: (task, data) => f.library.protection.encodeTask(task, data || f.library.snapshot()), decode: (task, required) => f.library.protection.decodeTask(task, required) };
    queue = await openDownloadQueue(f.root, (kind, input, signal, progress) => savePosePin(input, { ...f, extract: async (file, stage) => {
      await copyFile(file, path.join(stage, 'pose.mp4'));
      if (first) { first = false; ready(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled private pose')), { once: true })); }
    } }, signal, progress), () => {}, codec);
    const id = await queue.add('pin', { ...f.input, collectionId: f.collection.id, extractPose: true }, 'Extract pose · source movement');
    await started;
    const disk = await readFile(path.join(f.root, 'downloads.json'), 'utf8');
    assert.equal(disk.includes('source movement'), false);
    assert.equal(disk.includes(f.input.itemId), false);
    assert.ok(JSON.parse(disk)[0].encrypted);
    await queue.cancel(id);
    while (queue.snapshot()[0].state === 'running') await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(await readdir(path.join(f.root, 'staging')), []);
    await f.changeLibrary(draft => f.library.protection.lock(draft, f.collection.id));
    await assert.rejects(queue.retry(id), /Unlock/);
    await f.changeLibrary(draft => f.library.protection.unlock(draft, f.collection.id, password));
    await queue.retry(id);
    while (queue.snapshot().length && queue.snapshot()[0].state !== 'failed') await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(queue.snapshot(), []);
    const pose = f.library.snapshot().pins.find(pin => pin.items.some(item => item.poseFor === f.input.itemId));
    assert.ok(pose.items[1].vault);
    assert.equal(f.library.snapshot().pins.length, 1);
    assert.deepEqual(await decryptedVideo(f.library, pose.items[1]), await readFile('test/media/portrait.mp4'));
    assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'downloads.json'), 'utf8')), []);
  } finally { queue?.stop(); f.library.protection.clear(); await rm(f.root, { recursive: true, force: true }); }
});

test('pose queue persists and distinguishes selected video items while preventing duplicate jobs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-pose-queue-'));
  let queue;
  try {
    queue = await openDownloadQueue(root, async () => { throw new Error('missing pose model'); });
    const id = await queue.add('pin', { id: 'pin', itemId: 'video1', extractPose: true }, 'Extract pose');
    while (queue.snapshot()[0]?.state !== 'failed') await new Promise(resolve => setTimeout(resolve, 10));
    await assert.rejects(queue.add('pin', { id: 'pin', itemId: 'video1', extractPose: true }, 'duplicate'), /already has a task/);
    await queue.add('pin', { id: 'pin', itemId: 'video2', extractPose: true }, 'second video');
    while (queue.snapshot().some(task => ['queued', 'running'].includes(task.state))) await new Promise(resolve => setTimeout(resolve, 10));
    queue.stop();
    queue = await openDownloadQueue(root, () => { throw new Error('must not automatically run'); });
    assert.equal(queue.snapshot().length, 2);
    assert.equal(queue.snapshot()[0].id, id);
    assert.equal(queue.snapshot()[0].kind, 'pin', 'older Papan can still read and dismiss an unfinished task');
    await queue.dismiss(id);
    assert.equal(queue.snapshot().length, 1);
  } finally { queue?.stop(); await rm(root, { recursive: true, force: true }); }
});

test('optional pose runtime downloads only on demand, verifies bytes, repairs corruption and cleans cancelled setup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-pose-runtime-'));
  const bytes = Buffer.from('fixture executable bytes'), runtime = { name: 'papan-pose-fixture', size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), url: 'https://example.com/runtime' };
  let calls = 0;
  const progress = [], options = { runtime, fetchImpl: async () => { calls++; return new Response(bytes); } };
  try {
    assert.deepEqual(await readdir(root), []);
    assert.equal(calls, 0);
    const tools = await ensurePoseRuntime(root, undefined, message => progress.push(message), options);
    assert.deepEqual(await readFile(tools.command), bytes);
    if (process.platform !== 'win32') assert.equal((await stat(tools.command)).mode & 0o777, 0o700);
    assert.ok(progress.some(message => message.includes('pose runtime')));
    await ensurePoseRuntime(root, undefined, () => {}, { ...options, fetchImpl: () => { throw new Error('cached setup must be offline'); } });
    await writeFile(tools.command, 'bad executable');
    await ensurePoseRuntime(root, undefined, () => {}, options);
    assert.equal(calls, 2);
    await rm(tools.command);
    await assert.rejects(ensurePoseRuntime(root, undefined, () => {}, { ...options, fetchImpl: async () => new Response('incomplete') }), /incomplete or corrupted/);
    assert.deepEqual(await readdir(path.join(root, 'runtime')), []);
    const abort = controller();
    await assert.rejects(ensurePoseRuntime(root, abort.signal, message => { if (message.includes('%')) abort.abort(); }, options));
    assert.deepEqual(await readdir(path.join(root, 'runtime')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('album pose attachments belong to the selected original and cannot become covers or previews', async () => {
  const f = await fixture();
  try {
    const second = { ...f.pin.items[0], id: randomUUID() };
    await f.changeLibrary(draft => draft.pins[0].items.push(second));
    const first = await savePosePin(f.input, f);
    const other = await savePosePin({ ...f.input, itemId: second.id, poseItemId: randomUUID() }, f);
    assert.equal(f.library.snapshot().pins.length, 1);
    assert.equal(other.pin.items.length, 4);
    assert.equal(other.item.poseFor, second.id);
    assert.equal(first.item.poseFor, f.input.itemId);
    const retry = await savePosePin({ ...f.input, poseItemId: randomUUID() }, { ...f, extract: () => { throw new Error('existing attachment should not extract'); } });
    assert.equal(retry.item.id, first.item.id);
    assert.throws(() => poseSource(f.library, { id: f.pin.id, itemId: first.item.id }), /no saved video/);
    assert.throws(() => pinPreviews([{ itemId: first.item.id }], other.pin.items, first.item.id), /original saved media/);
    const collection = { ...f.collection, destination: path.join(f.root, 'album.papan') };
    await saveCollectionFile(f.root, f.library.snapshot(), collection);
    const manifest = JSON.parse(await readFile(collection.destination));
    for (const mutate of [
      data => { data.pins[0].coverId = first.item.id; },
      data => { data.pins[0].items[2].poseFor = randomUUID(); },
      data => { data.pins[0].items[3].poseFor = first.item.poseFor; },
      data => { data.pins[0].items[2].kind = 'image'; },
    ]) {
      const invalid = structuredClone(manifest); mutate(invalid);
      assert.throws(() => validateContents(invalid), /Invalid pose attachment/);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('media cleanup retains attachment folders through restart, deletion history and recovery snapshots', async () => {
  const f = await fixture();
  try {
    const result = await savePosePin(f.input, f), file = mediaLocation(f.root, result.item, true);
    const unused = randomUUID(); await mkdir(path.join(f.root, 'media', unused));
    const main = await readFile('src/main.js', 'utf8'), start = main.indexOf('export async function collectUnusedMedia('), end = main.indexOf('\nasync function createWindow(', start);
    assert.ok(start > 0 && end > start);
    const collect = new (Object.getPrototypeOf(async function () {}).constructor)('library', 'path', 'readFile', 'mediaLocation', 'removeMedia',
      main.slice(start, end).replace('export ', '') + '\nreturn collectUnusedMedia(library);');
    const { removeMedia } = await import('../src/media.js');
    const check = async library => collect(library, path, readFile, mediaLocation, removeMedia);
    const reopened = await openLibrary(f.root);
    await check(reopened);
    assert.deepEqual(await readFile(file), await readFile('test/media/portrait.mp4'));
    assert.equal((await readdir(path.join(f.root, 'media'))).includes(unused), false);
    await f.changeLibrary(draft => { draft.trash = [{ id: randomUUID(), pins: [{ pin: draft.pins[0], index: 0 }] }]; draft.pins = []; });
    await f.changeLibrary(draft => { draft.marker = 'keep trash through another commit'; });
    await check(f.library); assert.ok(await stat(file));
    await f.changeLibrary(draft => { draft.trash = []; });
    await check(f.library); assert.ok(await stat(file), 'previous snapshot preserves removed media');
    await f.changeLibrary(draft => { draft.marker = 'history gone from both snapshots'; });
    await check(f.library); await assert.rejects(readFile(file), { code: 'ENOENT' });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('an interrupted earlier separate-pin task adopts its committed media without extracting again', async () => {
  for (const protectedMode of [false, true]) {
    const f = await fixture();
    try {
      const oldId = randomUUID(), poseId = randomUUID(), folder = randomUUID(), url = new URL(f.pin.sourceUrl);
      url.hash = `papan-pose-${oldId}`;
      await mkdir(path.join(f.root, 'media', folder));
      await copyFile('test/media/portrait.mp4', path.join(f.root, 'media', folder, 'pose.mp4'));
      await f.changeLibrary(draft => draft.pins.push({ ...f.pin, id: oldId, folder, title: 'source movement · pose', sourceUrl: url.href, coverId: poseId, tags: ['pose-control'],
        items: [{ id: poseId, kind: 'video', localFile: `${folder}/pose.mp4`, previewFile: `${folder}/pose.mp4`, previewVersion: 1 }] }));
      if (protectedMode) await f.changeLibrary(draft => f.library.protection.setPassword(draft, f.collection.id, 'pose-test-password'));
      const input = { ...f.input, poseItemId: undefined, posePinId: oldId };
      const result = await savePosePin(input, { ...f, extract: () => { throw new Error('committed old result must not regenerate'); } });
      assert.equal(f.library.snapshot().pins.length, 1);
      assert.equal(result.pin.id, f.pin.id);
      assert.equal(result.item.id, poseId);
      assert.equal(result.item.poseFor, f.input.itemId);
      const bytes = protectedMode ? await decryptedVideo(f.library, result.item) : await readFile(mediaLocation(f.root, result.item, true));
      assert.deepEqual(bytes, await readFile('test/media/portrait.mp4'));
      await savePosePin(input, { ...f, extract: () => { throw new Error('retry must converge'); } });
      assert.equal(f.library.snapshot().pins[0].items.length, 2);
    } finally { f.library.protection.clear(); await rm(f.root, { recursive: true, force: true }); }
  }
});
