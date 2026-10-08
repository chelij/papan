import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { pinDetails, collectionSettings, newCollection, openLibrary } from '../src/library.js';
import { openDownloadQueue } from '../src/download-queue.js';
import { exportBundle, importBundle } from '../src/portable.js';

process.env.PAPAN_PYTHON_WORKER = '1';
const until = async predicate => { for (let i = 0; i < 400; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('State did not settle'); };

test('pin metadata validates bounded notes/tags and legacy click settings remain readable', () => {
  assert.deepEqual(pinDetails({ title: ' a pin ', tags: [' Design ', 'design', 'ideas'], notes: ' remember this ' }), { title: 'a pin', tags: ['design', 'ideas'], notes: 'remember this' });
  assert.equal(collectionSettings({ mode: 'offline' }).openAction, 'saved');
  assert.equal(collectionSettings({ mode: 'offline', openAction: 'source' }).openAction, 'source');
  for (const input of [{ title: '' }, { title: 'x', tags: [''] }, { title: 'x', tags: ['x'.repeat(41)] }, { title: 'x', notes: 'x'.repeat(10001) }]) assert.throws(() => pinDetails(input));
});

test('download queue persists failures, cancels active work, retries, and recovers interrupted tasks without automatic network activity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-queue-'));
  let attempts = 0, interrupted, slowStarted = false;
  const queue = await openDownloadQueue(root, async (_kind, payload, signal) => {
    attempts++;
    if (payload.id === 'failure' && attempts === 1) throw new Error('source unavailable');
    if (payload.id === 'slow') await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }); slowStarted = true; });
    return { collectionId: payload.id };
  });
  try {
    const failed = await queue.add('collection', { id: 'failure' }, 'retry me');
    await until(() => queue.snapshot()[0]?.state === 'failed');
    assert.match(queue.snapshot()[0].error, /source unavailable/);
    await queue.retry(failed);
    await until(() => queue.snapshot().length === 0);
    await until(async () => JSON.parse(await readFile(path.join(root, 'downloads.json'))).length === 0);
    assert.equal(attempts, 2);
    const slow = await queue.add('collection', { id: 'slow' }, 'cancel me');
    await until(async () => { interrupted = JSON.parse(await readFile(path.join(root, 'downloads.json'))); return slowStarted && interrupted.at(-1).state === 'running'; });
    await queue.cancel(slow);
    await until(() => queue.snapshot().at(-1).state === 'cancelled');
    await queue.dismiss(slow);
    assert.equal(queue.snapshot().length, 0);
    queue.stop();
    await writeFile(path.join(root, 'downloads.json'), JSON.stringify(interrupted));
    const recovered = await openDownloadQueue(root, () => { throw new Error('must not run automatically'); });
    assert.equal(recovered.snapshot().at(-1).state, 'failed');
    assert.match(recovered.snapshot().at(-1).error, /Interrupted/);
    recovered.stop();
  } finally { queue.stop(); await rm(root, { recursive: true, force: true }); }
});

test('download queue does not start work cancelled while publishing its persisted running status', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-queue-start-'));
  let queue, runs = 0, finish;
  const settled = new Promise(resolve => { finish = resolve; });
  queue = await openDownloadQueue(root, async () => { runs++; return {}; }, tasks => {
    const task = tasks[0];
    if (task?.state === 'running') void queue.cancel(task.id);
    if (['cancelled', 'completed'].includes(task?.state)) finish(task.state);
  });
  try {
    await queue.add('collection', { id: 'cancel-before-start' }, 'cancel before starting');
    assert.equal(await settled, 'cancelled');
    assert.equal(runs, 0);
    assert.equal(JSON.parse(await readFile(path.join(root, 'downloads.json')))[0].state, 'cancelled');
  } finally { queue.stop(); await rm(root, { recursive: true, force: true }); }
});

test('portable copy survives deletion of original media, keeps metadata, and rejects unsafe archives or missing files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papan-portable-'));
  const root = path.join(directory, 'old'), fresh = path.join(directory, 'new');
  await openLibrary(root); await openLibrary(fresh);
  const collection = newCollection('portable ideas', { mode: 'offline' }), folder = randomUUID(), itemId = randomUUID();
  await mkdir(path.join(root, 'media', folder));
  const bytes = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="green"/></svg>';
  await writeFile(path.join(root, 'media', folder, 'image.svg'), bytes);
  const snapshot = { collections: [collection], pins: [{ id: randomUUID(), collectionId: collection.id, folder,
    title: 'A green idea — 緑', notes: 'Keep the composition · warna', tags: ['design'], sourceUrl: 'https://example.com/pin', engine: 'page', offline: true,
    coverId: itemId, items: [{ id: itemId, kind: 'image', localFile: `${folder}/image.svg`, previewFile: `${folder}/image.svg` }] }] };
  const file = path.join(directory, 'portable.papan.zip');
  try {
    const exported = await exportBundle(root, snapshot, collection, file);
    assert.equal(exported.files, 2);
    const originalArchive = await readFile(file);
    await rm(path.join(root, 'media'), { recursive: true });
    await assert.rejects(exportBundle(root, snapshot, collection, file), /missing/);
    assert.deepEqual(await readFile(file), originalArchive, 'failed export preserves an earlier archive');
    const imported = await importBundle(fresh, file);
    assert.notEqual(imported.collection.id, collection.id);
    assert.equal(imported.collection.destination, undefined);
    assert.equal(imported.pins[0].title, 'A green idea — 緑');
    assert.equal(imported.pins[0].notes, 'Keep the composition · warna');
    assert.deepEqual(imported.pins[0].tags, ['design']);
    assert.equal(await readFile(path.join(fresh, 'media', imported.pins[0].items[0].localFile), 'utf8'), bytes);
    assert.equal(imported.pins[0].items[0].localPath, undefined);
    const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const unsafe = path.join(directory, 'unsafe.zip');
    execFileSync(python, ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("../escape.svg","bad"); z.writestr("collection.json","{}"); z.close()', unsafe]);
    await assert.rejects(importBundle(fresh, unsafe), /unsafe path/);
    await assert.rejects(readFile(path.join(fresh, 'escape.svg')));
    const malicious = path.join(directory, 'metadata.zip');
    execFileSync(python, ['-c', 'import sys,zipfile,json; a=zipfile.ZipFile(sys.argv[1]); b=zipfile.ZipFile(sys.argv[2],"w"); m=json.loads(a.read("collection.json")); m["collection"]["destination"]="/should/not/write.papan"; b.writestr("collection.json",json.dumps(m)); [b.writestr(n,a.read(n)) for n in a.namelist() if n!="collection.json"]; b.close()', file, malicious]);
    assert.equal((await importBundle(fresh, malicious)).collection.destination, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
