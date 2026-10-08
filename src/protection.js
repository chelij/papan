import { randomUUID } from 'node:crypto';
import { mkdir, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { collectionName, collectionSettings, pinDetails, pinPreviews } from './library.js';
import { mediaLocation } from './collection-files.js';
import { beginVault, unlockVault, wrapKey, vaultRange, validEntry, seal, unseal } from './vault.js';

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const belongs = (entry, id) => entry.collection?.id === id || entry.pins?.some(({ pin }) => pin.collectionId === id);
export function vaultStub(collection) {
  return Object.fromEntries(['id', 'name', 'createdAt', 'closed', 'destination', 'fileId', 'destinationRevision', 'vault'].filter(key => collection[key] !== undefined).map(key => [key, collection[key]]));
}
export function storedLibrary(data) {
  const stored = structuredClone(data), protectedIds = new Set([...data.collections, ...(data.trash || []).map(entry => entry.collection).filter(Boolean)].filter(c => c.vault).map(c => c.id));
  stored.collections = stored.collections.map(c => c.vault ? vaultStub(c) : c);
  stored.pins = stored.pins.filter(pin => !protectedIds.has(pin.collectionId));
  stored.trash = (stored.trash || []).filter(entry => entry.collection?.vault || ![...protectedIds].some(id => belongs(entry, id))).map(entry => entry.collection?.vault ? { ...entry, collection: vaultStub(entry.collection), pins: [] } : entry);
  return stored;
}
function contents(data, collection) {
  return { format: 'papan-encrypted', version: 1,
    collection: { id: collection.id, name: collection.name, settings: collection.settings, createdAt: collection.createdAt },
    pins: data.pins.filter(pin => pin.collectionId === collection.id),
    trash: (data.trash || []).filter(entry => !entry.collection && belongs(entry, collection.id)) };
}
function validateManifest(manifest, id) {
  const c = manifest.collection;
  if (!uuid.test(c.id)) throw new Error('Invalid encrypted collection.');
  const collection = { id, fileId: c.id, name: collectionName(c.name), settings: collectionSettings(c.settings), createdAt: c.createdAt };
  const checkURL = value => {
    if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid saved link.');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid saved link.');
  };
  const ids = new Set();
  const pins = [...manifest.pins, ...manifest.trash.flatMap(entry => entry.pins?.map(item => item.pin) || [])];
  for (const pin of pins) {
    if (!uuid.test(pin.id) || ids.has(pin.id) || !Array.isArray(pin.items) || !pin.items.length || pin.items.length > 50 || typeof pin.offline !== 'boolean' || !['page', 'gallery', 'video', 'instagram'].includes(pin.engine)) throw new Error('Invalid encrypted pin.');
    ids.add(pin.id); Object.assign(pin, pinDetails(pin)); pin.collectionId = id;
    checkURL(pin.sourceUrl);
    const items = new Set();
    for (const item of pin.items) {
      if (!uuid.test(item.id) || items.has(item.id) || !['image', 'video', 'text'].includes(item.kind)) throw new Error('Invalid encrypted media.');
      items.add(item.id);
      for (const field of ['url', 'poster']) if (item[field]) checkURL(item[field]);
      for (const field of ['width', 'height', 'previewWidth', 'previewHeight']) if (item[field] != null && (!Number.isFinite(item[field]) || item[field] < 0)) throw new Error('Invalid media dimensions.');
      if (item.kind === 'text') { if (typeof item.text !== 'string') throw new Error('Invalid saved text.'); }
      else {
        if (!item.vault?.preview && !item.vault?.original) throw new Error('Missing encrypted media.');
        for (const entry of [item.vault.preview, item.vault.original]) if (entry) validEntry(entry);
        item.vault.owner = id;
      }
      for (const field of ['previewFile', 'localFile', 'previewPath', 'localPath']) if (item[field]) throw new Error('An encrypted collection cannot reference plaintext files.');
    }
    if (!items.has(pin.coverId)) throw new Error('Invalid encrypted cover.');
    if (pin.items.some(item => item.poseFor !== undefined && (item.kind !== 'video' || item.id === pin.coverId || !pin.items.some(source => source.id === item.poseFor && source.kind === 'video' && !source.poseFor) || pin.items.filter(pose => pose.poseFor === item.poseFor).length !== 1))) throw new Error('Invalid pose attachment.');
    if (pin.previews !== undefined) pin.previews = pinPreviews(pin.previews, pin.items, pin.coverId);
  }
  for (const entry of manifest.trash) if (entry.collection || !uuid.test(entry.id) || !Array.isArray(entry.pins) || entry.pins.some(item => !Number.isInteger(item.index) || item.index < 0)) throw new Error('Invalid encrypted removal history.');
  return { collection, pins: manifest.pins, trash: manifest.trash };
}

export function collectionProtection(root) {
  let sessions = new Map();
  const vaultPath = collection => {
    if (!/^[0-9a-f-]{36}\.papan$/i.test(collection?.vault?.file)) throw new Error('Invalid local encrypted collection path.');
    return path.join(root, 'vaults', collection.vault.file);
  };
  const requireKey = id => {
    const session = sessions.get(id);
    if (!session || session.locking) throw new Error('Unlock this collection first.');
    return session;
  };
  const sourceFor = (item, kind) => {
    const field = kind === 'original' ? 'local' : 'preview';
    const plain = mediaLocation(root, { [`${field}File`]: item[`${field}File`], [`${field}Path`]: item[`${field}Path`] }, kind === 'original');
    if (plain) return { file: plain };
    if (item.vault?.[kind]) { const session = requireKey(item.vault.owner); return { file: session.file, key: session.sourceKey || session.key, entry: item.vault[kind] }; }
    return null;
  };
  return {
    vaultPath,
    hasKey: id => sessions.has(id),
    isUnlocked: id => sessions.has(id) && !sessions.get(id).locking,
    checkpoint: () => new Map([...sessions].map(([id, value]) => [id, { ...value }])),
    restore(previous) {
      for (const [id, session] of sessions) if (session.key !== previous.get(id)?.key) session.key.fill(0);
      sessions = previous;
    },
    finish(data, previous = new Map()) {
      for (const [id, session] of previous) if (session.key !== sessions.get(id)?.key) session.key.fill(0);
      for (const [id, session] of sessions) {
        const collection = data.collections.find(c => c.id === id);
        if (!collection?.vault || session.locking) { session.key.fill(0); sessions.delete(id); }
        else { session.sourceKey?.fill(0); delete session.sourceKey; delete session.rotate; session.file = vaultPath(collection); delete session.fresh; delete session.dirty; }
      }
    },
    clear() { for (const session of sessions.values()) session.key.fill(0); sessions.clear(); },
    async unlock(draft, id, password) {
      if (sessions.has(id)) return;
      const collection = draft.collections.find(c => c.id === id);
      if (!collection?.vault) throw new Error('This collection is not password protected.');
      const session = await unlockVault(vaultPath(collection), password);
      try {
        const loaded = validateManifest(session.manifest, id);
        sessions.set(id, { ...session, fresh: true });
        const occupied = new Set(draft.pins.filter(pin => pin.collectionId !== id).map(pin => pin.id));
        for (const pin of [...loaded.pins, ...loaded.trash.flatMap(entry => entry.pins.map(item => item.pin))]) {
          if (occupied.has(pin.id)) { pin.id = randomUUID(); sessions.get(id).dirty = true; }
          occupied.add(pin.id);
        }
        Object.assign(collection, loaded.collection);
        draft.pins = draft.pins.filter(pin => pin.collectionId !== id).concat(loaded.pins);
        draft.trash = (draft.trash || []).filter(entry => !belongs(entry, id)).concat(loaded.trash);
      } catch (error) { session.key.fill(0); throw error; }
    },
    lock(draft, id) {
      const collection = draft.collections.find(c => c.id === id);
      if (!collection?.vault) return;
      const session = sessions.get(id); if (session) session.locking = true;
      draft.collections[draft.collections.indexOf(collection)] = vaultStub(collection);
      draft.pins = draft.pins.filter(pin => pin.collectionId !== id);
      draft.trash = (draft.trash || []).filter(entry => !belongs(entry, id));
    },
    async setPassword(draft, id, password, currentPassword) {
      const collection = draft.collections.find(c => c.id === id);
      if (!collection) throw new Error('Collection not found.');
      if (collection.vault) {
        requireKey(id);
        const checked = await unlockVault(vaultPath(collection), currentPassword); checked.key.fill(0);
      }
      if (password === null) { delete collection.vault; return; }
      const old = sessions.get(id), next = await wrapKey(password);
      sessions.set(id, { ...next, file: old?.file, sourceKey: old?.key, rotate: Boolean(old), dirty: true });
      collection.vault ||= { file: '' };
    },
    async prepare(draft, before) {
      const created = [], plaintext = new Set(), temporaryMedia = [];
      // Removed protected boards retain their encrypted file and reopen locked on undo.
      for (const entry of draft.trash || []) if (entry.collection?.vault) { entry.collection = vaultStub(entry.collection); entry.pins = []; }
      const allPins = [...draft.pins, ...(draft.trash || []).flatMap(entry => entry.pins.map(item => item.pin))];
      try {
        // Moving to an unprotected collection, or removing its password, makes
        // independent local copies. The source vault remains recoverable.
        for (const pin of allPins) {
          const target = draft.collections.find(c => c.id === pin.collectionId);
          if (target?.vault || !pin.items.some(item => item.vault)) continue;
          const folder = randomUUID(), directory = path.join(root, 'media', folder);
          await mkdir(directory, { recursive: true, mode: 0o700 }); temporaryMedia.push(directory);
          for (const item of pin.items) {
            if (!item.vault) continue;
            for (const [kind, field] of [['preview', 'preview'], ['original', 'local']]) {
              const source = sourceFor(item, kind); if (!source?.entry) continue;
              const name = `${randomUUID()}${source.entry.ext}`, output = await open(path.join(directory, name), 'wx', 0o600);
              try { for await (const bytes of vaultRange(source.file, source.key, source.entry)) await output.writeFile(bytes); }
              finally { await output.close(); }
              item[`${field}File`] = `${folder}/${name}`; item[`${field}Path`] = null;
            }
            delete item.vault;
          }
          pin.folder = folder;
        }
        for (const collection of draft.collections.filter(c => c.vault)) {
          const session = sessions.get(collection.id);
          if (!session || session.locking || session.fresh && !session.dirty) continue;
          const previous = before.collections.find(c => c.id === collection.id);
          if (!session.dirty && previous && JSON.stringify(contents(draft, collection)) === JSON.stringify(contents(before, previous))) continue;
          const file = `${randomUUID()}.papan`, destination = path.join(root, 'vaults', file);
          created.push(destination);
          const writer = await beginVault(destination, session);
          try {
            for (const pin of allPins.filter(pin => pin.collectionId === collection.id)) {
              for (const item of pin.items.filter(item => item.kind !== 'text')) {
                const saved = { owner: collection.id };
                for (const kind of ['preview', 'original']) {
                  const source = sourceFor(item, kind); if (!source) continue;
                  if (source.entry && item.vault.owner === collection.id && source.key === session.key) saved[kind] = source.entry;
                  else {
                    saved[kind] = await writer.add(randomUUID(), source, source.entry?.ext || path.extname(source.file).toLowerCase());
                    if (!source.entry) plaintext.add(source.file);
                  }
                }
                if (!saved.preview && !saved.original) throw new Error('Save this pin’s media on this device before encrypting it.');
                item.vault = saved;
                for (const field of ['previewFile', 'localFile', 'previewPath', 'localPath']) delete item[field];
              }
              delete pin.folder;
            }
            await writer.finish(contents(draft, collection));
          } finally { await writer.close(); }
          collection.vault = { file };
        }
        // Do not delete imported originals or files still used by another board.
        const referenced = new Set(allPins.flatMap(pin => pin.items.flatMap(item => [mediaLocation(root, item), mediaLocation(root, item, true)]).filter(Boolean)));
        const owned = [...plaintext].filter(file => path.relative(path.join(root, 'media'), file).split(path.sep).length === 2 && uuid.test(path.relative(path.join(root, 'media'), file).split(path.sep)[0]));
        const folders = [...new Set(owned.map(file => path.dirname(file)))].filter(folder => ![...referenced].some(file => file.startsWith(folder + path.sep)));
        const remove = [...folders, ...owned.filter(file => !referenced.has(file) && !folders.includes(path.dirname(file)))];
        return { created, temporaryMedia, remove };
      } catch (error) {
        for (const file of [...created, ...temporaryMedia]) await rm(file, { recursive: true, force: true });
        throw error;
      }
    },
    media(item, original) {
      if (!item.vault) return null;
      const session = requireKey(item.vault.owner), entry = original ? item.vault.original || item.vault.preview : item.vault.preview || item.vault.original;
      return { size: entry.size, ext: entry.ext, stream: (start, end, signal) => vaultRange(session.file, session.key, entry, start, end, signal) };
    },
    encodeTask(task, data) {
      const stored = task, previousOwner = task.encrypted?.owner;
      if (task.encrypted) task = this.decodeTask(task, false, true);
      if (task.encrypted) return task;
      const ids = [...(stored.collections || []), task.payload?.pin?.collectionId, task.payload?.collectionId, task.kind === 'collection' ? task.payload?.id : data.pins.find(pin => pin.id === task.payload?.id)?.collectionId].filter(Boolean);
      const boards = [...data.collections, ...(data.trash || []).map(entry => entry.collection).filter(Boolean)];
      const owner = [...ids, previousOwner].find(id => boards.find(c => c.id === id)?.vault);
      if (!owner && previousOwner && !data.collections.some(c => c.id === previousOwner)) return stored;
      if (!owner) return task;
      const session = sessions.get(owner);
      if (!session) throw new Error('Unlock this collection first.');
      return { id: task.id, kind: task.kind, state: task.state, createdAt: task.createdAt, title: 'protected collection download', collections: [...new Set(ids)],
        encrypted: { owner, requires: [...new Set([...ids, owner].filter(id => boards.find(c => c.id === id)?.vault))], data: seal(Buffer.from(JSON.stringify(task)), session.key, `download:${task.id}`).toString('base64') } };
    },
    decodeTask(task, required = false, forSave = false) {
      if (!task.encrypted) return task;
      const session = sessions.get(task.encrypted.owner);
      if (!session || !forSave && (session.locking || (task.encrypted.requires || []).some(id => !this.isUnlocked(id)))) { if (required) throw new Error('Unlock the protected collection to retry this download.'); return task; }
      try {
        const bytes = Buffer.from(task.encrypted.data, 'base64');
        let plaintext;
        try { plaintext = unseal(bytes, session.key, `download:${task.id}`); }
        catch (error) { if (!session.sourceKey) throw error; plaintext = unseal(bytes, session.sourceKey, `download:${task.id}`); }
        const decoded = JSON.parse(plaintext.toString('utf8'));
        return { ...decoded, state: task.state, ...(task.error ? { error: task.error } : {}) };
      } catch {
        const error = 'This encrypted download is damaged. Dismiss it and save the link again.';
        if (required) throw new Error(error);
        return { ...task, error };
      }
    },
  };
}
