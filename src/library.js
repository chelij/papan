import { mkdir, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { collectionProtection, storedLibrary } from './protection.js';

// Retain openAction in version-1 files for older readers; Papan always opens its viewer.
export const defaultSettings = { mode: 'online', openAction: 'saved', density: 3, fit: 'contain', motion: true, slideshowSeconds: 4 };

export function collectionSettings(input = {}) {
  const settings = { ...defaultSettings, ...input };
  settings.openAction = input.openAction ?? defaultSettings.openAction;
  // Keep these mappings while libraries with the earlier column settings are supported.
  if (input.density === undefined && input.columns !== undefined) settings.density = input.columns;
  if (input.density === undefined && input.columns === undefined && input.tileSize !== undefined) settings.density = { small: 4, medium: 3, large: 2 }[input.tileSize];
  if (!['online', 'offline'].includes(settings.mode) || !Number.isFinite(settings.density) || !Number.isInteger(settings.density * 2) || settings.density < 0.5 || settings.density > 20 ||
      !['source', 'saved'].includes(settings.openAction) || !['cover', 'contain'].includes(settings.fit) || typeof settings.motion !== 'boolean' ||
      !Number.isInteger(settings.slideshowSeconds) || settings.slideshowSeconds < 1 || settings.slideshowSeconds > 10) {
    throw new Error('Invalid collection settings.');
  }
  return Object.fromEntries(Object.keys(defaultSettings).map(key => [key, settings[key]]));
}

export function collectionName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error('Use a collection name between 1 and 80 characters.');
  return value.trim();
}

export function pinDetails(input) {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) throw new Error('Use a pin title between 1 and 200 characters.');
  const notes = input.notes ?? '', tags = input.tags ?? [];
  if (typeof notes !== 'string' || notes.length > 10000) throw new Error('Keep notes within 10,000 characters.');
  if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40)) throw new Error('Use up to 20 tags, each between 1 and 40 characters.');
  return { title: input.title.trim(), notes: notes.trim(), tags: [...new Map(tags.map(tag => [tag.trim().toLowerCase(), tag.trim()])).values()] };
}

export function pinPreviews(input, items, coverId) {
  if (input === undefined) return undefined; // Existing pins use all visual media, or saved text when there is none.
  if (!Array.isArray(input) || !input.length || input.length > items.length) throw new Error('Choose at least one saved item for the board preview.');
  const selected = new Set();
  const previews = input.map(preview => {
    const item = items.find(item => item.id === preview?.itemId);
    if (!item || item.poseFor || selected.has(item.id)) throw new Error('Choose each preview from the pin’s original saved media once.');
    selected.add(item.id);
    if (item.kind !== 'video') {
      if (preview.start !== undefined || preview.end !== undefined) throw new Error('Only video previews can have a clip range.');
      return { itemId: item.id };
    }
    const start = preview.start ?? 0, end = preview.end ?? null;
    if (!Number.isFinite(start) || start < 0 || (end !== null && (!Number.isFinite(end) || end <= start))) throw new Error('A video preview must end after its start time.');
    return { itemId: item.id, start, end };
  });
  if (!selected.has(coverId)) throw new Error('Choose a cover from the selected previews.');
  return previews;
}

export async function openLibrary(root) {
  await mkdir(path.join(root, 'media'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(root, 'vaults'), { recursive: true, mode: 0o700 });
  const file = path.join(root, 'library.json'), backup = path.join(root, 'library.previous.json');
  const protection = collectionProtection(root);
  let data, warning = '';
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.collections) || !Array.isArray(data.pins)) throw new Error('Unrecognized library format.');
    for (const collection of data.collections) {
      if (collection.vault) protection.vaultPath(collection);
      else collection.settings = collectionSettings(collection.settings);
    }
    for (const pin of data.pins) {
      if (pin.items.some(item => item.poseFor !== undefined && (item.kind !== 'video' || item.id === pin.coverId || !pin.items.some(source => source.id === item.poseFor && source.kind === 'video' && !source.poseFor) || pin.items.filter(pose => pose.poseFor === item.poseFor).length !== 1))) throw new Error('Invalid pose attachment.');
      if (pin.previews !== undefined) pin.previews = pinPreviews(pin.previews, pin.items, pin.coverId);
    }
    data = storedLibrary(data); // Always start with protected collections locked.
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Papan could not read its library. Your files have been preserved. ${error.message}`);
    data = { version: 1, collections: [], pins: [] };
  }
  const writeAtomic = async (destination, value) => {
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
  };
  async function cleanPlaintext() {
    const pending = [];
    for (const relative of data.protectionCleanup || []) {
      if (!/^[0-9a-f-]{36}(?:\/[a-zA-Z0-9_.-]+)?$/.test(relative)) continue;
      try { await rm(path.join(root, 'media', relative), { recursive: !relative.includes('/'), force: true }); }
      catch { pending.push(relative); }
    }
    if ((data.protectionCleanup || []).length) {
      data.protectionCleanup = pending;
      await writeAtomic(file, storedLibrary(data));
    }
    warning = pending.length ? 'Encryption is saved, but some old local media copies could not be removed. Check file permissions and restart Papan to finish cleanup.' : '';
  }
  async function collectVaults() {
    const saved = [storedLibrary(data)];
    try { saved.push(JSON.parse(await readFile(backup, 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') return; }
    const used = new Set(saved.flatMap(value => [...value.collections, ...(value.trash || []).map(entry => entry.collection).filter(Boolean)]).map(c => c.vault?.file).filter(Boolean));
    for (const name of await readdir(path.join(root, 'vaults'))) if (/^[0-9a-f-]{36}\.papan$/i.test(name) && !used.has(name)) await rm(path.join(root, 'vaults', name));
  }
  await cleanPlaintext();
  await collectVaults();
  let queue = Promise.resolve();
  return {
    root, protection,
    snapshot: () => structuredClone(data),
    publicSnapshot() {
      const snapshot = structuredClone(data);
      snapshot.protectionWarning = warning;
      delete snapshot.protectionCleanup;
      for (const collection of [...snapshot.collections, ...(snapshot.trash || []).map(entry => entry.collection).filter(Boolean)]) {
        collection.protected = Boolean(collection.vault);
        collection.locked = collection.protected && !protection.isUnlocked(collection.id);
        collection.settings ||= { ...defaultSettings };
        delete collection.vault;
      }
      const locked = new Set(snapshot.collections.filter(c => c.locked).map(c => c.id));
      snapshot.pins = snapshot.pins.filter(pin => !locked.has(pin.collectionId));
      snapshot.trash = (snapshot.trash || []).filter(entry => entry.collection || !entry.pins.some(({ pin }) => locked.has(pin.collectionId)));
      for (const pin of [...snapshot.pins, ...(snapshot.trash || []).flatMap(entry => entry.pins.map(item => item.pin))]) for (const item of pin.items) {
        if (item.vault) { item.encrypted = true; delete item.vault; }
      }
      return snapshot;
    },
    requireUnlocked(id, snapshot = data) {
      const collection = snapshot.collections.find(c => c.id === id);
      if (!collection) throw new Error('Collection not found.');
      if (collection.vault && !protection.isUnlocked(id)) throw new Error('Unlock this collection first.');
      return collection;
    },
    mutate(operation, onFailure = async () => {}, beforeCommit = async () => {}) {
      const next = queue.then(async () => {
        const draft = structuredClone(data), sessions = protection.checkpoint();
        let prepared, backupBefore, backupWritten = false;
        try { backupBefore = await readFile(backup); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        try {
          const result = await operation(draft);
          prepared = await protection.prepare(draft, data);
          await beforeCommit(draft, data);
          draft.protectionCleanup = [...new Set([...(data.protectionCleanup || []), ...prepared.remove.map(file => path.relative(path.join(root, 'media'), file).split(path.sep).join('/'))])];
          // Encryption/password changes replace recovery metadata too. A move into
          // a protected board must not leave its former plaintext pin in the backup.
          const resetBackup = prepared.remove.length || draft.collections.some(c => c.vault && (!data.collections.find(old => old.id === c.id)?.vault || sessions.get(c.id)?.envelope?.equals(protection.checkpoint().get(c.id)?.envelope) === false));
          await writeAtomic(backup, storedLibrary(resetBackup ? draft : data));
          backupWritten = true;
          await writeAtomic(file, storedLibrary(draft));
          data = draft;
          protection.finish(data, sessions);
          // The committed cleanup journal is retried on startup after interruption.
          try { await cleanPlaintext(); await collectVaults(); }
          catch { warning = 'Encryption is saved. Restart Papan to finish removing old local copies.'; }
          return result;
        } catch (error) {
          const failures = [];
          try {
            if (backupWritten) {
              if (backupBefore) await writeAtomic(backup, JSON.parse(backupBefore));
              else await rm(backup, { force: true });
            }
          } catch (recoveryError) { failures.push(recoveryError); }
          try { await onFailure(); } catch (recoveryError) { failures.push(recoveryError); }
          protection.restore(sessions);
          if (!failures.length) {
            for (const file of [...(prepared?.created || []), ...(prepared?.temporaryMedia || [])]) await rm(file, { recursive: true, force: true });
          } else {
            throw new Error(`The save failed and recovery could not finish. Your prior library and recovery files have been preserved. ${failures.map(item => item.message).join(' ')}`);
          }
          throw error;
        }
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}

export function newCollection(name, settings) {
  return { id: randomUUID(), name: collectionName(name), settings: collectionSettings(settings), createdAt: new Date().toISOString() };
}
