import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pinPreviews, newCollection, openLibrary } from '../src/library.js';
import { saveCollectionFile, readCollectionFile } from '../src/collection-files.js';
import { exportBundle, importBundle } from '../src/portable.js';

process.env.PAPAN_PYTHON_WORKER = '1';

test('preview selections require saved media, a selected cover, and valid video ranges', () => {
  const items = [{ id: 'image', kind: 'image' }, { id: 'video', kind: 'video' }, { id: 'text', kind: 'text' }];
  const selection = [{ itemId: 'video', start: 2.25, end: 4.75 }, { itemId: 'image' }];
  assert.equal(pinPreviews(undefined, items, 'image'), undefined, 'legacy pins retain their automatic preview selection');
  assert.deepEqual(pinPreviews(selection, items, 'video'), selection);
  assert.deepEqual(pinPreviews([{ itemId: 'video' }], items, 'video'), [{ itemId: 'video', start: 0, end: null }]);
  for (const input of [null, [], [{ itemId: 'missing' }], [{ itemId: 'image' }, { itemId: 'image' }],
    [{ itemId: 'image', start: 0 }], [{ itemId: 'text', end: 1 }],
    ...[-1, NaN, Infinity, '2'].map(start => [{ itemId: 'video', start }]),
    ...[0, 2, NaN, Infinity, '3'].map(end => [{ itemId: 'video', start: 2, end }])]) {
    assert.throws(() => pinPreviews(input, items, input?.[0]?.itemId), JSON.stringify(input));
  }
  assert.throws(() => pinPreviews(selection, items, 'text'), /cover/);
});

test('preview choices survive library reload, saved lists and portable copies without changing media', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papan-previews-'));
  const root = path.join(directory, 'library'), importedRoot = path.join(directory, 'imported');
  const library = await openLibrary(root);
  await openLibrary(importedRoot);
  const collection = newCollection('clips'), folder = randomUUID(), imageId = randomUUID(), videoId = randomUUID();
  const selection = [{ itemId: videoId, start: 1.5, end: 4.25 }];
  const pin = { id: randomUUID(), collectionId: collection.id, folder, engine: 'page', offline: false,
    sourceUrl: 'https://example.com/post', title: 'A selected clip', coverId: videoId, previews: selection,
    items: [{ id: imageId, kind: 'image', previewFile: `${folder}/image.webp` }, { id: videoId, kind: 'video', previewFile: `${folder}/video.mp4` }] };
  try {
    await mkdir(path.join(root, 'media', folder));
    await writeFile(path.join(root, 'media', folder, 'image.webp'), 'complete image');
    await writeFile(path.join(root, 'media', folder, 'video.mp4'), 'complete video');
    await library.mutate(draft => { draft.collections.push(collection); draft.pins.push(pin); });
    const reloaded = await openLibrary(root);
    assert.deepEqual(reloaded.snapshot().pins[0].previews, selection);
    collection.destination = path.join(directory, 'clips.papan');
    await saveCollectionFile(root, reloaded.snapshot(), collection);
    const loaded = await readCollectionFile(collection.destination, { collections: [] });
    assert.deepEqual(loaded.pins[0].previews, selection);
    assert.equal(loaded.pins[0].items.length, 2, 'unselected saved media is retained');
    const bundle = path.join(directory, 'clips.papan.zip');
    await exportBundle(root, reloaded.snapshot(), collection, bundle);
    const imported = await importBundle(importedRoot, bundle);
    assert.deepEqual(imported.pins[0].previews, selection);
    assert.equal(imported.pins[0].items.length, 2);
    assert.equal(await readFile(path.join(importedRoot, 'media', imported.pins[0].items[1].previewFile), 'utf8'), 'complete video');
    const malformed = JSON.parse(await readFile(collection.destination, 'utf8'));
    malformed.pins[0].previews[0].end = 0;
    await writeFile(collection.destination, JSON.stringify(malformed));
    await assert.rejects(readCollectionFile(collection.destination, { collections: [] }), /end after/);
    assert.equal(await readFile(path.join(root, 'media', folder, 'video.mp4'), 'utf8'), 'complete video');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
