import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openLibrary, newCollection } from '../src/library.js';
import { unlockVault, vaultHeader, readVault } from '../src/vault.js';
import { fileResponse } from '../src/file-response.js';
import { saveCollectionFile } from '../src/collection-files.js';
import { openDownloadQueue } from '../src/download-queue.js';

const password = 'a long test password 🔑';
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-protection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = await openLibrary(root), collection = newCollection('private collection');
  const folder = randomUUID(), itemId = randomUUID();
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 43);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const item = { id: itemId, kind: 'video', previewFile: `${folder}/preview.mp4`, localFile: `${folder}/original.mp4`, url: 'https://example.com/secret-video' };
  const pin = { id: randomUUID(), collectionId: collection.id, title: 'secret pin title', sourceUrl: 'https://example.com/secret-pin', engine: 'page', offline: true, folder, items: [item], coverId: itemId, notes: 'secret personal note', tags: ['secret-tag'] };
  await mkdir(path.join(root, 'media', folder));
  await writeFile(path.join(root, 'media', item.previewFile), bytes);
  await writeFile(path.join(root, 'media', item.localFile), bytes);
  await library.mutate(draft => { draft.collections.push(collection); draft.pins.push(pin); });
  const protect = () => library.mutate(draft => library.protection.setPassword(draft, collection.id, password));
  return { root, library, collection, pin, item, bytes, protect };
}
async function readMedia(library, item, start = 0, end) {
  const descriptor = library.protection.media(item, true);
  const response = await fileResponse(descriptor, new Request('http://localhost/media', { headers: { range: `bytes=${start}-${end ?? descriptor.size - 1}` } }), 'video/mp4');
  assert.equal(response.status, 206); assert.equal(response.headers.get('cache-control'), 'no-store');
  return Buffer.from(await response.arrayBuffer());
}

test('encryption removes plaintext metadata/media, locks on restart, authenticates passwords, and streams seek ranges', async t => {
  const { root, library, collection, item, bytes, protect } = await fixture(t);
  await protect();
  const snapshot = library.snapshot(), savedItem = snapshot.pins[0].items[0];
  assert.equal(library.publicSnapshot().collections[0].locked, false);
  assert.equal(library.publicSnapshot().pins[0].items[0].encrypted, true);
  assert.equal(library.publicSnapshot().pins[0].items[0].vault, undefined);
  for (const file of ['library.json', 'library.previous.json']) {
    const text = await readFile(path.join(root, file), 'utf8');
    for (const secret of ['secret pin', 'secret personal', 'secret-video', 'secret-tag']) assert.ok(!text.includes(secret), file);
  }
  await assert.rejects(readFile(path.join(root, 'media', item.localFile)), { code: 'ENOENT' });
  assert.deepEqual(await readMedia(library, savedItem, 1024 * 1024 - 19, 1024 * 1024 + 29), bytes.subarray(1024 * 1024 - 19, 1024 * 1024 + 30));
  const vault = library.protection.vaultPath(snapshot.collections[0]);
  const encrypted = await readFile(vault);
  assert.ok(!encrypted.includes(Buffer.from('secret personal note')));
  assert.ok(!encrypted.includes(bytes.subarray(0, 100)));
  const reopened = await openLibrary(root);
  assert.equal(reopened.publicSnapshot().collections[0].locked, true);
  assert.equal(reopened.snapshot().pins.length, 0);
  assert.throws(() => reopened.requireUnlocked(collection.id), /Unlock/);
  await assert.rejects(reopened.mutate(draft => reopened.protection.unlock(draft, collection.id, 'wrong password')), /Incorrect password/);
  await reopened.mutate(draft => reopened.protection.unlock(draft, collection.id, password));
  assert.equal(reopened.snapshot().pins[0].notes, 'secret personal note');
  await reopened.mutate(draft => { draft.pins[0].notes = 'edited secret note'; });
  await reopened.mutate(draft => reopened.protection.lock(draft, collection.id));
  assert.equal(reopened.snapshot().pins.length, 0);
  assert.throws(() => reopened.protection.media(savedItem, true), /Unlock/);
  await reopened.mutate(draft => reopened.protection.unlock(draft, collection.id, password));
  assert.equal(reopened.snapshot().pins[0].notes, 'edited secret note');
  assert.deepEqual(await readMedia(reopened, reopened.snapshot().pins[0].items[0]), bytes);
  library.protection.clear(); reopened.protection.clear();
});

test('failed encryption is reversible; password changes update recovery; remove protection restores files', async t => {
  const { root, library, collection, item, bytes, protect } = await fixture(t);
  await assert.rejects(library.mutate(draft => library.protection.setPassword(draft, collection.id, password), undefined, () => { throw new Error('destination offline'); }), /destination offline/);
  assert.equal(library.snapshot().collections[0].vault, undefined);
  assert.deepEqual(await readFile(path.join(root, 'media', item.localFile)), bytes);
  assert.deepEqual(await readdir(path.join(root, 'vaults')), []);
  await protect();
  const oldKey = (await unlockVault(library.protection.vaultPath(library.snapshot().collections[0]), password)).key;
  await assert.rejects(library.mutate(draft => library.protection.setPassword(draft, collection.id, 'replacement password', 'wrong password')), /Incorrect/);
  await library.mutate(draft => library.protection.setPassword(draft, collection.id, 'replacement password', password));
  await assert.rejects(readVault(library.protection.vaultPath(library.snapshot().collections[0]), oldKey), /authenticat/i); oldKey.fill(0);
  for (const file of await readdir(path.join(root, 'vaults'))) {
    await assert.rejects(unlockVault(path.join(root, 'vaults', file), password), /Incorrect/);
    const opened = await unlockVault(path.join(root, 'vaults', file), 'replacement password'); opened.key.fill(0);
  }
  await library.mutate(draft => library.protection.setPassword(draft, collection.id, null, 'replacement password'));
  const saved = library.snapshot();
  assert.equal(saved.collections[0].vault, undefined);
  assert.equal(saved.pins[0].items[0].vault, undefined);
  assert.deepEqual(await readFile(path.join(root, 'media', saved.pins[0].items[0].localFile)), bytes);
});

test('encrypted exports and external previous copies remain encrypted; damaged metadata or chunks fail authentication', async t => {
  const { root, library, collection, protect } = await fixture(t);
  const file = path.join(root, 'external.papan');
  await library.mutate(async draft => { draft.collections[0].destination = file; draft.collections[0].destinationRevision = await saveCollectionFile(root, draft, draft.collections[0]); });
  await protect();
  await library.mutate(() => {}, undefined, async draft => { draft.collections[0].destinationRevision = await saveCollectionFile(root, draft, draft.collections[0]); });
  for (const name of ['external.papan', 'external.previous.papan']) {
    const opened = await unlockVault(path.join(root, name), password);
    assert.equal(opened.manifest.pins[0].title, 'secret pin title'); opened.key.fill(0);
  }
  const vault = library.protection.vaultPath(library.snapshot().collections[0]), corrupt = path.join(root, 'corrupt.papan');
  await copyFile(vault, corrupt);
  const header = await vaultHeader(corrupt), content = await readFile(corrupt);
  content[header.offset + 30] ^= 1; await writeFile(corrupt, content);
  await assert.rejects(unlockVault(corrupt, password), /Incorrect password or damaged/);
  await copyFile(vault, corrupt);
  const bytes = await readFile(corrupt), item = library.snapshot().pins[0].items[0];
  bytes[item.vault.original.offset + 30] ^= 1; await writeFile(corrupt, bytes);
  const opened = await unlockVault(corrupt, password);
  // Corruption in a media chunk is rejected when that chunk is requested.
  const { vaultRange } = await import('../src/vault.js');
  await assert.rejects(Array.fromAsync(vaultRange(corrupt, opened.key, item.vault.original)), /authenticat/i);
  opened.key.fill(0);
});

test('moving media across protection boundaries preserves it and locked task persistence contains no secrets', async t => {
  const { root, library, collection, pin, bytes, protect } = await fixture(t);
  const target = newCollection('ordinary collection');
  await library.mutate(draft => draft.collections.push(target));
  await protect();
  await library.mutate(draft => { draft.pins[0].collectionId = target.id; });
  let saved = library.snapshot().pins[0];
  assert.equal(saved.items[0].vault, undefined);
  assert.deepEqual(await readFile(path.join(root, 'media', saved.items[0].localFile)), bytes);
  await library.mutate(draft => { draft.pins[0].collectionId = collection.id; });
  saved = library.snapshot().pins[0];
  assert.deepEqual(await readMedia(library, saved.items[0]), bytes);
  const codec = { encode: (task, data) => library.protection.encodeTask(task, data || library.snapshot()), decode: (task, required) => library.protection.decodeTask(task, required) };
  const downloads = await openDownloadQueue(root, async () => { throw new Error('secret failure details'); }, () => {}, codec);
  const id = await downloads.add('save', { pin }, 'secret task title');
  while (!downloads.snapshot().some(task => task.state === 'failed')) await new Promise(resolve => setTimeout(resolve, 10));
  await downloads.recode(library.snapshot());
  const disk = await readFile(path.join(root, 'downloads.json'), 'utf8');
  assert.ok(!disk.includes('secret')); assert.ok(!disk.includes(pin.sourceUrl));
  await library.mutate(draft => library.protection.lock(draft, collection.id));
  assert.equal(downloads.snapshot()[0].title, 'protected collection download');
  await assert.rejects(downloads.retry(id), /Unlock/);
  await library.mutate(draft => library.protection.unlock(draft, collection.id, password));
  assert.equal(downloads.snapshot()[0].title, 'secret task title');
  downloads.stop();
});

test('protection preserves external originals and shared files; removal history stays encrypted and can be restored', async t => {
  const { root, library, collection, pin, item, bytes, protect } = await fixture(t);
  const external = path.join(root, 'imported-original.mp4'); await writeFile(external, bytes);
  const shared = newCollection('shared media');
  await library.mutate(draft => {
    draft.collections.push(shared);
    draft.pins.push({ ...structuredClone(pin), id: randomUUID(), collectionId: shared.id });
    draft.pins[0].items[0].localPath = external;
    draft.trash = [{ id: randomUUID(), pins: [{ pin: { ...structuredClone(pin), id: randomUUID(), title: 'removed secret pin' }, index: 0 }] }];
  });
  await protect();
  assert.deepEqual(await readFile(external), bytes);
  assert.deepEqual(await readFile(path.join(root, 'media', item.localFile)), bytes);
  assert.deepEqual(await readFile(path.join(root, 'media', item.previewFile)), bytes);
  assert.ok(!(await readFile(path.join(root, 'library.json'), 'utf8')).includes('removed secret pin'));
  let removed;
  await library.mutate(draft => {
    library.protection.lock(draft, collection.id);
    const index = draft.collections.findIndex(c => c.id === collection.id);
    removed = { id: randomUUID(), collection: draft.collections[index], index, pins: [] };
    draft.trash.push(removed); draft.collections.splice(index, 1);
  });
  assert.equal(library.snapshot().pins.length, 1);
  assert.ok(JSON.parse(await readFile(path.join(root, 'library.json'))).trash.some(entry => entry.collection?.vault));
  await library.mutate(draft => { draft.collections.push(removed.collection); draft.trash = draft.trash.filter(entry => entry.id !== removed.id); });
  assert.equal(library.publicSnapshot().collections.find(c => c.id === collection.id).locked, true);
  await library.mutate(draft => library.protection.unlock(draft, collection.id, password));
  assert.equal(library.snapshot().pins.length, 2);
  assert.equal(library.snapshot().trash[0].pins[0].pin.title, 'removed secret pin');
});

test('an encrypted portable copy opens independently with unique pin IDs and no original library', async t => {
  const { root, library, protect, bytes } = await fixture(t);
  await protect();
  const portable = path.join(root, 'portable.papan');
  await copyFile(library.protection.vaultPath(library.snapshot().collections[0]), portable);
  const importedRoot = path.join(root, 'independent'), imported = await openLibrary(importedRoot);
  const newId = randomUUID(), file = `${randomUUID()}.papan`;
  await copyFile(portable, path.join(importedRoot, 'vaults', file));
  await imported.mutate(draft => { draft.collections.push({ id: newId, name: 'portable', vault: { file } }); });
  library.protection.clear();
  await rm(path.join(root, 'media'), { recursive: true, force: true });
  await rm(path.join(root, 'vaults'), { recursive: true, force: true });
  await imported.mutate(draft => imported.protection.unlock(draft, newId, password));
  assert.equal(imported.snapshot().pins[0].collectionId, newId);
  assert.deepEqual(await readMedia(imported, imported.snapshot().pins[0].items[0]), bytes);
  // Opening the same export twice must not collide with existing pin identities.
  const secondId = randomUUID(), secondFile = `${randomUUID()}.papan`;
  await copyFile(portable, path.join(importedRoot, 'vaults', secondFile));
  await imported.mutate(draft => draft.collections.push({ id: secondId, name: 'copy', vault: { file: secondFile } }));
  await imported.mutate(draft => imported.protection.unlock(draft, secondId, password));
  const pins = imported.snapshot().pins;
  assert.equal(new Set(pins.map(pin => pin.id)).size, 2);
  assert.deepEqual(await readMedia(imported, pins[1].items[0]), bytes);
  imported.protection.clear();
});

test('empty and text-only encrypted collections preserve content and reject invalid passwords', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-text-vault-')); t.after(() => rm(root, { recursive: true, force: true }));
  const library = await openLibrary(root), collection = newCollection('text collection');
  await library.mutate(draft => draft.collections.push(collection));
  await assert.rejects(library.mutate(draft => library.protection.setPassword(draft, collection.id, 'short')), /between 8/);
  await library.mutate(draft => library.protection.setPassword(draft, collection.id, password));
  const itemId = randomUUID();
  await library.mutate(draft => draft.pins.push({ id: randomUUID(), collectionId: collection.id, title: 'private article', sourceUrl: 'https://example.com/article', engine: 'page', offline: true, coverId: itemId,
    items: [{ id: itemId, kind: 'text', text: 'private article contents' }] }));
  await library.mutate(draft => library.protection.lock(draft, collection.id));
  const fresh = await openLibrary(root);
  await fresh.mutate(draft => fresh.protection.unlock(draft, collection.id, password));
  assert.equal(fresh.snapshot().pins[0].items[0].text, 'private article contents');
  assert.ok(!(await readFile(path.join(root, 'library.previous.json'), 'utf8')).includes('private article'));
  fresh.protection.clear();
});

test('existing completed history is removed without losing failed tasks', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-history-')); t.after(() => rm(root, { recursive: true, force: true }));
  const tasks = ['completed', 'failed', 'completed'].map(state => ({ id: randomUUID(), kind: 'collection', payload: { id: randomUUID() }, title: state, state }));
  await writeFile(path.join(root, 'downloads.json'), JSON.stringify(tasks));
  const downloads = await openDownloadQueue(root, () => { throw new Error('Must not run'); });
  assert.deepEqual(downloads.snapshot().map(task => task.state), ['failed']);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'downloads.json'))).map(task => task.state), ['failed']); downloads.stop();
});


test('password rotation re-encrypts queued details and a failed change rolls back their key too', async t => {
  const { root, library, collection, pin, protect } = await fixture(t); await protect();
  const codec = { encode: (task, data) => library.protection.encodeTask(task, data || library.snapshot()), decode: (task, required) => library.protection.decodeTask(task, required) };
  const downloads = await openDownloadQueue(root, async () => { throw new Error('retry me'); }, () => {}, codec);
  await downloads.add('save', { pin }, 'protected failed task');
  while (!downloads.snapshot().some(task => task.state === 'failed')) await new Promise(resolve => setTimeout(resolve, 10));
  let restore;
  await assert.rejects(library.mutate(draft => library.protection.setPassword(draft, collection.id, 'changed password', password), () => restore?.(), async draft => {
    restore = await downloads.recode(draft); throw new Error('external write failed');
  }), /external write failed/);
  assert.equal(downloads.snapshot()[0].title, 'protected failed task');
  let restarted = await openDownloadQueue(root, () => {}, () => {}, codec);
  assert.equal(restarted.snapshot()[0].title, 'protected failed task'); restarted.stop();
  await library.mutate(draft => library.protection.setPassword(draft, collection.id, 'changed password', password), () => restore?.(), async draft => { restore = await downloads.recode(draft); });
  assert.equal(downloads.snapshot()[0].title, 'protected failed task');
  library.protection.clear();
  const fresh = await openLibrary(root);
  await fresh.mutate(draft => fresh.protection.unlock(draft, collection.id, 'changed password'));
  restarted = await openDownloadQueue(root, () => {}, () => {}, { encode: task => fresh.protection.encodeTask(task, fresh.snapshot()), decode: (task, required) => fresh.protection.decodeTask(task, required) });
  assert.equal(restarted.snapshot()[0].title, 'protected failed task');
  restarted.stop(); downloads.stop(); fresh.protection.clear();
});
