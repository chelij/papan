import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { openLibrary, newCollection } from '../src/library.js';
import { saveCollectionFile, readCollectionFile, mediaLocation } from '../src/collection-files.js';

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papan-collection-files-'));
  const root = path.join(directory, 'library'), destination = path.join(directory, 'saved');
  await openLibrary(root);
  await mkdir(destination);
  const file = path.join(destination, 'places.papan');
  const collection = { ...newCollection('saved places', { mode: 'offline', density: 5 }), destination: file };
  const folder = randomUUID(), imageId = randomUUID(), textId = randomUUID();
  await mkdir(path.join(root, 'media', folder));
  await writeFile(path.join(root, 'media', folder, 'preview.webp'), 'preview bytes');
  await writeFile(path.join(root, 'media', folder, 'original.png'), 'original bytes');
  const pin = { id: randomUUID(), collectionId: collection.id, folder, engine: 'page', title: 'An album', sourceUrl: 'https://example.com/post', offline: true,
    coverId: imageId, items: [{ id: imageId, kind: 'image', url: 'https://example.com/image.png', width: 1600, height: 1200,
      previewFile: `${folder}/preview.webp`, localFile: `${folder}/original.png` }, { id: textId, kind: 'text', text: 'A saved caption' }] };
  const other = newCollection('not exported');
  const snapshot = { version: 1, collections: [collection, other], pins: [pin, { ...pin, id: randomUUID(), collectionId: other.id }] };
  return { directory, root, destination, collection, pin, snapshot, file };
}

test('collection files save only the list/settings and reopen references without copying or moving media', async () => {
  const f = await fixture();
  try {
    f.collection.destinationRevision = await saveCollectionFile(f.root, f.snapshot, f.collection);
    const first = await readFile(f.file, 'utf8'), saved = JSON.parse(first);
    assert.equal(saved.pins.length, 1);
    assert.equal(saved.collection.settings.density, 5);
    assert.equal(saved.collection.destination, undefined);
    assert.deepEqual(await readdir(f.destination), ['places.papan'], 'no media copied into destination');
    assert.equal(saved.pins[0].items[0].previewPath, path.join(f.root, 'media', f.pin.items[0].previewFile));
    assert.equal(saved.pins[0].items[0].localPath, path.join(f.root, 'media', f.pin.items[0].localFile));
    assert.equal(saved.pins[0].items[0].localFile, undefined);
    f.collection.name = 'updated places';
    f.collection.destinationRevision = await saveCollectionFile(f.root, f.snapshot, f.collection);
    assert.equal(await readFile(path.join(f.destination, 'places.previous.papan'), 'utf8'), first);
    assert.equal(JSON.parse(await readFile(f.file)).collection.name, 'updated places');
    const loaded = await readCollectionFile(f.file, { collections: [], pins: [] });
    assert.equal(loaded.collection.id, f.collection.id);
    assert.equal(loaded.collection.closed, false);
    assert.equal(loaded.pins[0].items[1].text, 'A saved caption');
    assert.equal(mediaLocation('/a/different/library', loaded.pins[0].items[0], true), path.join(f.root, 'media', f.pin.items[0].localFile));
    assert.equal(await readFile(mediaLocation(f.root, loaded.pins[0].items[0], true), 'utf8'), 'original bytes');
    const again = await readCollectionFile(f.file, { collections: [loaded.collection], pins: loaded.pins });
    assert.equal(again.collection.id, loaded.collection.id, 'opening the same file reuses its collection');
    const copy = path.join(f.destination, 'copy.papan');
    await writeFile(copy, await readFile(f.file));
    const separate = await readCollectionFile(copy, { collections: [loaded.collection], pins: loaded.pins });
    assert.notEqual(separate.collection.id, loaded.collection.id, 'another saved file does not overwrite an existing collection');
    assert.equal(separate.collection.fileId, f.collection.id);
    assert.deepEqual(await readdir(path.join(f.root, 'media', f.pin.folder)), ['original.png', 'preview.webp']);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('failed and stale saves preserve files; missing media remains in the saved list', async () => {
  const f = await fixture();
  try {
    await writeFile(f.file, 'keep this unrelated file');
    await assert.rejects(saveCollectionFile(f.root, f.snapshot, f.collection));
    assert.equal(await readFile(f.file, 'utf8'), 'keep this unrelated file');
    await rm(f.file);
    f.collection.destinationRevision = await saveCollectionFile(f.root, f.snapshot, f.collection);
    const before = await readFile(f.file, 'utf8');
    const currentRevision = f.collection.destinationRevision;
    const backup = path.join(f.destination, 'places.previous.papan');
    await writeFile(backup, 'unrelated notes');
    await assert.rejects(saveCollectionFile(f.root, f.snapshot, f.collection), /backup location/);
    assert.equal(await readFile(backup, 'utf8'), 'unrelated notes');
    assert.equal(await readFile(f.file, 'utf8'), before);
    await rm(backup);
    f.collection.destinationRevision = randomUUID();
    await assert.rejects(saveCollectionFile(f.root, f.snapshot, f.collection), /newer collection/);
    assert.equal(await readFile(f.file, 'utf8'), before);
    f.collection.destinationRevision = currentRevision;
    await rm(path.join(f.root, 'media', f.pin.items[0].previewFile));
    f.collection.destinationRevision = await saveCollectionFile(f.root, f.snapshot, f.collection);
    const loaded = await readCollectionFile(f.file, { collections: [] });
    assert.equal(loaded.pins[0].items[0].previewPath, path.join(f.root, 'media', f.pin.items[0].previewFile));
    f.collection.destination = path.join(f.directory, 'disconnected', 'places.papan');
    await assert.rejects(saveCollectionFile(f.root, f.snapshot, f.collection), /unavailable/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('collection files reject unsafe references and malformed metadata without opening media', async () => {
  const f = await fixture();
  try {
    await saveCollectionFile(f.root, f.snapshot, f.collection);
    const original = JSON.parse(await readFile(f.file));
    for (const modify of [
      data => { data.pins[0].items[0].localPath = '../../keep.png'; },
      data => { data.pins[0].items[0].localPath = path.join(f.directory, 'private.txt'); },
      data => { data.pins[0].items[0].url = 'file:///private'; },
      data => { data.pins[0].items[0].kind = 'script'; },
      data => { data.pins.push(data.pins[0]); },
    ]) {
      const invalid = structuredClone(original); modify(invalid);
      await writeFile(f.file, JSON.stringify(invalid));
      await assert.rejects(readCollectionFile(f.file, { collections: [] }));
    }
    await writeFile(f.file, '{broken');
    await assert.rejects(readCollectionFile(f.file, { collections: [] }));
    assert.equal(await readFile(path.join(f.root, 'media', f.pin.items[0].localFile), 'utf8'), 'original bytes');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
