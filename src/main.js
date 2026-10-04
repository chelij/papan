import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, realpath, rm, copyFile, stat } from 'node:fs/promises';
import { openLibrary, newCollection, collectionName, collectionSettings, pinDetails, pinPreviews } from './library.js';
import { collectionContents, saveCollectionFile, readCollectionFile, mediaLocation } from './collection-files.js';
import { inspectLink, materialize, removeMedia, extractWorker, webURL, BROWSER_SESSION_MODES } from './media.js';
import { openDownloadQueue } from './download-queue.js';
import { exportBundle, importBundle } from './portable.js';
import { isVault, vaultHeader } from './vault.js';
import { fileResponse } from './file-response.js';
import { openPhoneReceiver } from './phone-receiver.js';
import { savePhoneLink } from './phone-save.js';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName('Papan');
app.commandLine.appendSwitch('disable-http-cache');
if (process.env.PAPAN_DATA_DIR) app.setPath('userData', path.resolve(process.env.PAPAN_DATA_DIR));
protocol.registerSchemesAsPrivileged([{ scheme: 'papan', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const inspections = new Map(), jobs = new Map();
let library, window, downloads, phoneReceiver, protectionBusy = false;
let browserSession = 'auto', browserSessionWrites = Promise.resolve();

async function changeLibrary(operation, saveId = null) {
  const restorations = [];
  let restoreDownloads, restorePhoneInbox, preserveRestorations = false;
  try {
    return await library.mutate(operation, async () => {
      const failures = [];
      try { await restoreDownloads?.(); } catch (error) { failures.push(error); }
      try { await restorePhoneInbox?.(); } catch (error) { failures.push(error); }
      for (const { file, contents, copy } of restorations.reverse()) {
        const temporary = `${file}.${randomUUID()}.rollback`;
        try {
          if (copy) await rename(copy, file);
          else if (contents === null) await rm(file, { force: true });
          else { await writeFile(temporary, contents, { mode: 0o600 }); await rename(temporary, file); }
        } catch (error) {
          preserveRestorations = true;
          const recovery = path.join(library.root, 'recovery');
          await mkdir(recovery, { recursive: true, mode: 0o700 });
          const saved = path.join(recovery, `${randomUUID()}-${path.basename(file)}`);
          try {
            if (copy) { await copyFile(copy, saved); await rm(copy, { force: true }); }
            else if (contents) await writeFile(saved, contents, { mode: 0o600 });
          } catch (recoveryError) {
            preserveRestorations = true;
            failures.push(new Error(`Keep any .rollback files beside the collection destination. Recovery could not finish: ${recoveryError.message}`));
          }
          failures.push(new Error(`The destination became unavailable during recovery. Preserved copies are in ${recovery}. ${error.message}`));
        } finally { await rm(temporary, { force: true }).catch(() => {}); }
      }
      if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join(' '));
    }, async (draft, before) => {
      if (protectionBusy) restoreDownloads = await downloads.recode(draft);
      if (protectionBusy) restorePhoneInbox = await phoneReceiver?.recode(draft);
      for (const collection of draft.collections) {
        if (!collection.destination) continue;
        const previous = before.collections.find(item => item.id === collection.id);
        if (collection.id === saveId || collection.destination !== previous?.destination ||
            JSON.stringify(collectionContents(draft, collection, library.root)) !== JSON.stringify(previous ? collectionContents(before, previous, library.root) : null)) {
          for (const file of [collection.destination, `${collection.destination.slice(0, -path.extname(collection.destination).length)}.previous.papan`]) {
            let contents = null, copy;
            try {
              if (await isVault(file)) { copy = `${file}.${randomUUID()}.rollback`; await copyFile(file, copy); }
              else { if ((await stat(file)).size > 64 * 1024 * 1024) throw new Error('Invalid collection destination.'); contents = await readFile(file); }
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
            restorations.push({ file, contents, copy });
          }
          collection.destinationRevision = await saveCollectionFile(library.root, draft, collection);
        }
        retainReferencedMedia(draft, draft.pins.filter(pin => pin.collectionId === collection.id));
      }
    });
  } finally {
    for (const { copy } of restorations) if (copy && !preserveRestorations) await rm(copy, { force: true }).catch(() => {});
  }
}

async function protectCollection(input, action) {
  if (jobs.size || phoneReceiver?.busy || downloads.snapshot().some(task => ['queued', 'running'].includes(task.state))) throw new Error('Wait for downloads and other saves to finish before changing the lock.');
  protectionBusy = true;
  try {
    await session.defaultSession.clearCache();
    const result = await changeLibrary(draft => action(draft, input.id));
    inspections.clear();
    downloads.publish();
    return result === undefined ? library.publicSnapshot() : result;
  } finally { protectionBusy = false; phoneReceiver?.pump(); publishPhoneInbox(); }
}

function publishPhoneInbox(value = phoneReceiver?.snapshot()) {
  if (value && window && !window.isDestroyed()) window.webContents.send('papan:phone-inbox', value);
}

async function openCollectionFile(file) {
  if (jobs.size || downloads.snapshot().some(task => ['queued', 'running'].includes(task.state))) throw new Error('Wait for downloads and other saves to finish before opening a collection file.');
  if (await isVault(file)) {
    const destination = path.join(await realpath(path.dirname(file)), path.basename(file));
    const header = await vaultHeader(file), vault = `${randomUUID()}.papan`;
    const local = path.join(library.root, 'vaults', vault);
    await copyFile(file, local);
    try {
      return await library.mutate(draft => {
        const existing = draft.collections.find(c => c.destination === destination);
        if (existing) library.protection.lock(draft, existing.id);
        const collection = { id: existing?.id || randomUUID(), name: existing?.name || path.basename(file, path.extname(file)).slice(0, 80) || 'encrypted collection',
          destination, destinationRevision: header.revision, vault: { file: vault }, closed: false, createdAt: existing?.createdAt || new Date().toISOString() };
        draft.collections = draft.collections.filter(c => c.id !== collection.id).concat(collection);
        draft.pins = draft.pins.filter(pin => pin.collectionId !== collection.id);
        return collection;
      });
    } catch (error) { await rm(local, { force: true }); throw error; }
  }
  if (file.toLowerCase().endsWith('.zip')) {
    const imported = await importBundle(library.root, file);
    try {
      return await changeLibrary(draft => { draft.collections.push(imported.collection); draft.pins.push(...imported.pins); return imported.collection; });
    } catch (error) { await removeMedia(library.root, imported.folder); throw error; }
  }
  return library.mutate(async draft => {
    const loaded = await readCollectionFile(file, draft);
    const index = draft.collections.findIndex(item => item.id === loaded.collection.id);
    if (index === -1) draft.collections.push(loaded.collection); else { library.protection.lock(draft, loaded.collection.id); draft.collections[index] = loaded.collection; }
    draft.pins = draft.pins.filter(pin => pin.collectionId !== loaded.collection.id).concat(loaded.pins);
    retainReferencedMedia(draft, loaded.pins);
    return loaded.collection;
  });
}

async function preparePin(input) {
  if (input.newCollection !== undefined && typeof input.newCollection !== 'boolean' || input.newCollection && input.collectionId) throw new Error('Invalid collection selection.');
  const inspection = inspections.get(input.inspectionId);
  if (!inspection || Date.now() - inspection.time > 30 * 60 * 1000) throw new Error('This preview expired. Paste the link again.');
  if (!Array.isArray(input.selectedIds) || !input.selectedIds.length || input.selectedIds.length > 50 || new Set(input.selectedIds).size !== input.selectedIds.length) throw new Error('Select between 1 and 50 items.');
  const data = inspection.data, items = data.items.filter(item => input.selectedIds.includes(item.id));
  if (items.length !== input.selectedIds.length) throw new Error('The selected items were not found.');
  const details = pinDetails({ ...input, title: input.title?.trim() || data.title });
  const snapshot = library.snapshot();
  let target = input.newCollection ? null : input.collectionId ? snapshot.collections.find(item => item.id === input.collectionId) : snapshot.collections.find(item => !item.closed && (!item.vault || library.protection.isUnlocked(item.id)));
  if (input.collectionId && !target || target?.closed) throw new Error('Open the collection before adding a pin.');
  if (!target) target = await changeLibrary(draft => { const created = newCollection('new collection'); draft.collections.push(created); return created; });
  library.requireUnlocked(target.id);
  if (snapshot.pins.some(pin => pin.collectionId === target.id && pin.sourceUrl === data.sourceUrl)) throw new Error('This link is already in this collection.');
  return { pin: { id: randomUUID(), collectionId: target.id, sourceUrl: data.sourceUrl, engine: data.engine,
    ...details, author: data.author, text: data.text, items,
    coverId: items.some(item => item.id === input.coverId) ? input.coverId : items[0].id, createdAt: new Date().toISOString() } };
}

async function savePin({ pin }, signal, progress) {
  const snapshot = library.snapshot(), target = snapshot.collections.find(item => item.id === pin.collectionId);
  if (!target) throw new Error('The destination collection was removed.');
  library.requireUnlocked(target.id);
  if (snapshot.pins.some(item => item.collectionId === pin.collectionId && item.sourceUrl === pin.sourceUrl)) throw new Error('This link is already in this collection.');
  const saved = await materialize(pin, library.root, target.settings.mode === 'offline', signal, progress, browserSession);
  try {
    return await changeLibrary(draft => {
      signal?.throwIfAborted();
      const current = draft.collections.find(item => item.id === pin.collectionId);
      if (!current) throw new Error('The destination collection was removed.');
      if (current.settings.mode === 'offline' && !saved.offline) throw new Error('The storage setting changed. Retry to download the originals.');
      if (draft.pins.some(item => item.collectionId === pin.collectionId && item.sourceUrl === pin.sourceUrl)) throw new Error('This link is already in this collection.');
      draft.pins.push(saved);
      return { pin: saved, collectionId: pin.collectionId };
    });
  } catch (error) { await removeMedia(library.root, saved.folder); throw error; }
}

async function updateCollection(input, signal, progress = () => {}) {
  const settings = collectionSettings(input.settings), name = collectionName(input.name);
  const snapshot = library.snapshot(), current = snapshot.collections.find(item => item.id === input.id);
  if (!current) throw new Error('Collection not found.');
  library.requireUnlocked(current.id);
  const converted = [];
  try {
    const pins = settings.mode === 'offline' ? snapshot.pins.filter(pin => pin.collectionId === input.id && !pin.offline) : [];
    for (const [index, pin] of pins.entries()) {
      progress(`downloading originals · pin ${index + 1} of ${pins.length}`);
      converted.push(await materialize(pin, library.root, true, signal, message => progress(`pin ${index + 1} of ${pins.length} · ${message}`), browserSession));
    }
    return await changeLibrary(draft => {
      signal?.throwIfAborted();
      const collection = draft.collections.find(item => item.id === input.id);
      if (!collection) throw new Error('The collection was removed.');
      if (JSON.stringify(collection.settings) !== JSON.stringify(current.settings) || collection.name !== current.name) throw new Error('Collection settings changed during the download. Retry to apply this change.');
      if (settings.mode === 'offline' && draft.pins.some(pin => pin.collectionId === input.id && !pin.offline && !converted.some(item => item.id === pin.id))) throw new Error('New pins were added during the download. Retry to include them.');
      for (const saved of converted) {
        const pin = draft.pins.find(pin => pin.id === saved.id && pin.collectionId === input.id);
        if (pin) Object.assign(pin, { items: saved.items, folder: saved.folder, offline: true });
      }
      collection.name = name; collection.settings = settings;
      return { ...collection, collectionId: collection.id };
    });
  } finally {
    const used = new Set(library.snapshot().pins.map(pin => pin.folder));
    for (const pin of converted) if (!used.has(pin.folder)) await removeMedia(library.root, pin.folder);
  }
}

async function updatePin(input, signal, progress) {
  if (input.repairPreviews) {
    const pin = library.snapshot().pins.find(pin => pin.id === input.id);
    if (!pin) throw new Error('Pin not found.');
    library.requireUnlocked(pin.collectionId);
    if (!pin.items.some(item => item.kind === 'video' && item.previewVersion !== 1)) return { pin, collectionId: pin.collectionId };
    const saved = await materialize(pin, library.root, pin.offline, signal, progress, browserSession);
    try {
      return await changeLibrary(draft => {
        signal?.throwIfAborted();
        const current = draft.pins.find(item => item.id === pin.id);
        if (JSON.stringify(current) !== JSON.stringify(pin)) throw new Error('This pin changed while rebuilding its preview. Retry the repair.');
        Object.assign(current, { items: saved.items, folder: saved.folder });
        return { pin: current, collectionId: current.collectionId };
      });
    } finally {
      if (!library.snapshot().pins.some(pin => pin.folder === saved.folder)) await removeMedia(library.root, saved.folder);
    }
  }
  const details = pinDetails(input), snapshot = library.snapshot();
  const pin = snapshot.pins.find(pin => pin.id === input.id), target = snapshot.collections.find(item => item.id === input.collectionId);
  if (!pin || !target) throw new Error('The pin or collection no longer exists.');
  library.requireUnlocked(pin.collectionId); library.requireUnlocked(target.id);
  if (!pin.items.some(item => item.id === input.coverId)) throw new Error('Choose a cover from this pin.');
  const previews = pinPreviews(input.previews === undefined ? pin.previews : input.previews, pin.items, input.coverId);
  if (snapshot.pins.some(item => item.id !== pin.id && item.collectionId === target.id && item.sourceUrl === pin.sourceUrl)) throw new Error('This link is already in the destination collection.');
  let saved;
  try {
    if (target.settings.mode === 'offline' && !pin.offline) saved = await materialize(pin, library.root, true, signal, progress, browserSession);
    return await changeLibrary(draft => {
      signal?.throwIfAborted();
      const current = draft.pins.find(item => item.id === pin.id), destination = draft.collections.find(item => item.id === target.id);
      if (!current || !destination) throw new Error('The pin or destination was removed.');
      if (JSON.stringify(current) !== JSON.stringify(pin)) throw new Error('This pin changed while you were editing. Reopen its details and try again.');
      if (destination.settings.mode === 'offline' && !current.offline && !saved) throw new Error('The destination now requires originals. Retry this move.');
      if (draft.pins.some(item => item.id !== pin.id && item.collectionId === target.id && item.sourceUrl === pin.sourceUrl)) throw new Error('This link is already in the destination collection.');
      if (saved) Object.assign(current, { items: saved.items, folder: saved.folder, offline: true });
      Object.assign(current, details, { coverId: input.coverId, collectionId: target.id });
      if (previews !== undefined) current.previews = previews;
      destination.closed = false;
      if (pin.collectionId !== target.id) { draft.pins.splice(draft.pins.indexOf(current), 1); draft.pins.push(current); }
      return { pin: current, collectionId: target.id };
    });
  } catch (error) { if (saved) await removeMedia(library.root, saved.folder); throw error; }
}

function retainReferencedMedia(draft, pins) {
  const folders = new Set(draft.retainedMedia || []);
  for (const pin of pins) for (const item of pin.items) for (const original of [false, true]) {
    const file = mediaLocation(library.root, item, original);
    if (!file) continue;
    const relative = path.relative(path.join(library.root, 'media'), file);
    if (/^[0-9a-f-]{36}$/.test(relative.split(path.sep)[0])) folders.add(relative.split(path.sep)[0]);
  }
  draft.retainedMedia = [...folders];
}

async function job(id, action) {
  if (typeof id !== 'string' || id.length > 80 || jobs.has(id)) throw new Error('Invalid request.');
  const controller = new AbortController();
  jobs.set(id, controller);
  const progress = message => {
    if (window && !window.isDestroyed()) window.webContents.send('papan:progress', { id, message });
  };
  try { return await action(controller.signal, progress); }
  finally { jobs.delete(id); }
}

function handle(name, action) {
  ipcMain.handle(`papan:${name}`, async (event, input) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'papan://app/index.html') return { ok: false, error: 'Untrusted request.' };
    try {
      if (protectionBusy && !['library', 'downloads', 'cancel'].includes(name)) throw new Error('Wait for the collection lock to finish updating.');
      const value = await action(input);
      const sanitize = item => {
        if (!item || typeof item !== 'object') return item;
        if (Array.isArray(item)) return item.map(sanitize);
        const result = Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'vault').map(([key, value]) => [key, sanitize(value)]));
        if (item.vault) {
          if (item.kind) result.encrypted = true;
          else { result.protected = true; result.locked = !library.protection.isUnlocked(item.id); }
        }
        return result;
      };
      return { ok: true, value: sanitize(value) };
    }
    catch (error) { return { ok: false, error: error.name === 'AbortError' ? 'Cancelled.' : error.message }; }
  });
}

function installHandlers() {
  handle('library', () => library.publicSnapshot());
  handle('phone-receiver', () => phoneReceiver.snapshot());
  handle('configure-phone', async input => {
    let created;
    if (input.enabled && input.collectionId === 'new-inbox') {
      created = await changeLibrary(draft => { const c = newCollection('Inbox'); draft.collections.push(c); return c; });
      input = { ...input, collectionId: created.id };
    }
    try { return await phoneReceiver.configure(input); }
    catch (error) {
      if (created) await changeLibrary(draft => { if (!draft.pins.some(pin => pin.collectionId === created.id)) draft.collections = draft.collections.filter(c => c.id !== created.id); });
      throw error;
    }
  });
  handle('pair-phone', () => phoneReceiver.pair());
  handle('revoke-phone', id => phoneReceiver.revoke(id));
  handle('retry-phone-share', id => phoneReceiver.retry(id));
  handle('dismiss-phone-share', id => phoneReceiver.dismiss(id));
  handle('clear-phone-receipts', () => phoneReceiver.clearSaved());
  handle('unlock-collection', input => protectCollection(input, (draft, id) => library.protection.unlock(draft, id, input.password)));
  handle('lock-collection', input => protectCollection(input, (draft, id) => library.protection.lock(draft, id)));
  handle('protect-collection', input => protectCollection(input, (draft, id) => library.protection.setPassword(draft, id, input.password, input.currentPassword)));
  handle('cancel', id => { jobs.get(id)?.abort(); });
  handle('tools', () => extractWorker({ action: 'versions' }));
  handle('browser-session', () => browserSession);
  handle('set-browser-session', value => {
    if (!BROWSER_SESSION_MODES.includes(value)) throw new Error('Invalid browser-session mode.');
    const save = browserSessionWrites.then(async () => {
      const file = path.join(library.root, 'browser-session.json'), temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify({ browser: value }), { mode: 0o600 }); await rename(temporary, file); browserSession = value; }
      finally { await rm(temporary, { force: true }); }
      return browserSession;
    });
    browserSessionWrites = save.catch(() => {}); return save;
  });
  handle('inspect', input => job(input.requestId, async signal => {
    const result = await inspectLink(input.url, signal, browserSession);
    if (signal.aborted) throw new Error('Cancelled.');
    const id = randomUUID();
    for (const [key, value] of inspections) if (Date.now() - value.time > 30 * 60 * 1000) inspections.delete(key);
    if (inspections.size >= 20) inspections.delete(inspections.keys().next().value);
    const inspected = { ...result, items: result.items.map(item => ({ ...item, id: randomUUID() })), id };
    inspections.set(id, { time: Date.now(), data: inspected });
    return inspected;
  }));
  handle('save', input => job(input.requestId, async (signal, progress) => savePin(await preparePin(input), signal, progress)));
  handle('enqueue-save', async input => {
    const payload = await preparePin(input);
    try {
      const taskId = await downloads.add('save', payload, payload.pin.title);
      return { taskId, collectionId: payload.pin.collectionId };
    } catch (error) {
      if (input.newCollection) await changeLibrary(draft => {
        if (!draft.pins.some(pin => pin.collectionId === payload.pin.collectionId)) draft.collections = draft.collections.filter(item => item.id !== payload.pin.collectionId);
      });
      throw error;
    }
  });
  handle('downloads', () => downloads.snapshot());
  handle('cancel-download', id => downloads.cancel(id));
  handle('retry-download', id => downloads.retry(id));
  handle('dismiss-download', id => downloads.dismiss(id));
  handle('create-collection', input => changeLibrary(draft => {
    const collection = newCollection(input.name, input.settings);
    draft.collections.push(collection);
    return collection;
  }));
  handle('update-collection', input => job(input.requestId, (signal, progress) => updateCollection(input, signal, progress)));
  handle('set-preview-size', input => changeLibrary(draft => { library.requireUnlocked(input.id, draft).settings.density = collectionSettings({ density: input.density }).density; }));
  handle('copy-link', id => {
    const pin = library.snapshot().pins.find(pin => pin.id === id);
    if (!pin) throw new Error('Pin not found.');
    library.requireUnlocked(pin.collectionId);
    clipboard.writeText(pin.sourceUrl);
  });
  handle('repair-previews', id => {
    const pin = library.snapshot().pins.find(pin => pin.id === id);
    if (!pin) throw new Error('Pin not found.');
    library.requireUnlocked(pin.collectionId);
    return downloads.add('pin', { id, collectionId: pin.collectionId, repairPreviews: true }, `Repair video preview · ${pin.title}`);
  });
  handle('enqueue-collection', input => {
    const payload = { id: input.id, name: collectionName(input.name), settings: collectionSettings(input.settings) };
    library.requireUnlocked(payload.id);
    return downloads.add('collection', payload, `Download originals · ${payload.name}`);
  });
  handle('update-pin', input => job(input.requestId, (signal, progress) => updatePin(input, signal, progress)));
  handle('enqueue-pin', input => {
    const payload = { id: input.id, ...pinDetails(input), collectionId: input.collectionId, coverId: input.coverId };
    const pin = library.snapshot().pins.find(item => item.id === input.id);
    if (!pin) throw new Error('Pin not found.');
    library.requireUnlocked(pin.collectionId); library.requireUnlocked(payload.collectionId);
    payload.previews = pinPreviews(input.previews === undefined ? pin.previews : input.previews, pin.items, input.coverId);
    return downloads.add('pin', payload, `Move · ${payload.title}`);
  });
  handle('delete-pin', id => changeLibrary(draft => {
    const index = draft.pins.findIndex(pin => pin.id === id);
    if (index === -1) throw new Error('Pin not found.');
    const removed = { id: randomUUID(), pins: [{ pin: draft.pins[index], index }], createdAt: new Date().toISOString() };
    draft.trash = [...(draft.trash || []), removed].slice(-20);
    draft.pins.splice(index, 1);
    return removed.id;
  }));
  handle('delete-collection', id => protectCollection({ id }, draft => {
    const index = draft.collections.findIndex(item => item.id === id);
    if (index === -1) throw new Error('Collection not found.');
    library.protection.lock(draft, id);
    const removed = { id: randomUUID(), collection: draft.collections[index], index,
      pins: draft.pins.map((pin, index) => ({ pin, index })).filter(item => item.pin.collectionId === id), createdAt: new Date().toISOString() };
    draft.trash = [...(draft.trash || []), removed].slice(-20);
    draft.pins = draft.pins.filter(pin => pin.collectionId !== id);
    draft.collections.splice(index, 1);
    return removed.id;
  }));
  handle('undo-remove', id => changeLibrary(draft => {
    const removed = id ? draft.trash?.find(item => item.id === id) : draft.trash?.at(-1);
    if (!removed) throw new Error('Nothing to restore.');
    if (removed.collection) {
      if (draft.collections.some(item => item.id === removed.collection.id || item.destination && item.destination === removed.collection.destination)) throw new Error('That collection is already open.');
      draft.collections.splice(Math.min(removed.index, draft.collections.length), 0, removed.collection);
    }
    const collectionId = removed.collection?.id || removed.pins[0]?.pin.collectionId;
    const target = draft.collections.find(item => item.id === collectionId);
    if (!target) throw new Error('Restore the collection first, then restore this pin.');
    if (!removed.collection) library.requireUnlocked(target.id, draft);
    for (const { pin, index } of removed.pins) {
      if (draft.pins.some(item => item.id === pin.id || item.collectionId === pin.collectionId && item.sourceUrl === pin.sourceUrl)) throw new Error('This link is already in the collection.');
      draft.pins.splice(Math.min(index, draft.pins.length), 0, pin);
    }
    target.closed = false;
    draft.trash = draft.trash.filter(item => item !== removed);
    return collectionId;
  }));
  handle('reorder', input => changeLibrary(draft => {
    if (!['pin', 'collection'].includes(input?.kind) || typeof input.id !== 'string' ||
        !(input.beforeId === null || typeof input.beforeId === 'string')) throw new Error('Invalid move.');
    const items = input.kind === 'pin' ? draft.pins : draft.collections;
    const item = items.find(entry => entry.id === input.id);
    const before = input.beforeId === null ? null : items.find(entry => entry.id === input.beforeId);
    if (!item || (input.beforeId !== null && !before)) throw new Error('This item no longer exists.');
    if (input.kind === 'pin' && before && before.collectionId !== item.collectionId) throw new Error('Reorder pins within the same collection.');
    if (item !== before) {
      items.splice(items.indexOf(item), 1);
      const index = before ? items.indexOf(before) : input.kind === 'pin' ? items.findLastIndex(entry => entry.collectionId === item.collectionId) + 1 : items.length;
      items.splice(index, 0, item);
    }
    return null;
  }).then(() => library.publicSnapshot()));
  handle('save-collection', async input => {
    const current = library.snapshot().collections.find(item => item.id === input?.id);
    if (!current) throw new Error('Collection not found.');
    let destination = current.destination;
    if (!destination || input.chooseDestination) {
      const filename = current.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '') || 'collection';
      const chosen = await dialog.showSaveDialog(window, { title: 'Save collection', buttonLabel: 'Save collection',
        defaultPath: destination || path.join(app.getPath('documents'), `${filename}.papan`),
        filters: [{ name: 'Papan collection', extensions: ['papan'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
      if (chosen.canceled || !chosen.filePath) return null;
      const file = chosen.filePath.toLowerCase().endsWith('.papan') ? chosen.filePath : `${chosen.filePath}.papan`;
      destination = path.join(await realpath(path.dirname(file)), path.basename(file));
    }
    return changeLibrary(draft => {
      const collection = draft.collections.find(item => item.id === current.id);
      if (!collection) throw new Error('Collection not found.');
      if (draft.collections.some(item => item.id !== collection.id && item.destination === destination)) throw new Error('Another collection already uses this destination.');
      if (collection.destination !== destination) delete collection.destinationRevision;
      collection.destination = destination;
      collection.fileId ||= collection.id;
      return collection;
    }, current.id);
  });
  handle('clear-collection-history', () => changeLibrary(draft => {
    draft.hiddenRecentCollections = draft.collections.filter(item => item.closed).map(item => item.id);
  }));
  handle('close-collection', id => protectCollection({ id }, (draft) => {
    const collection = draft.collections.find(item => item.id === id);
    if (!collection) throw new Error('Collection not found.');
    collection.closed = true;
    if (draft.hiddenRecentCollections) draft.hiddenRecentCollections = draft.hiddenRecentCollections.filter(item => item !== id);
    library.protection.lock(draft, id);
  }));
  handle('reopen-collection', async id => {
    const current = library.snapshot().collections.find(item => item.id === id);
    if (!current) throw new Error('Collection not found.');
    let warning;
    if (current.destination && !current.vault) {
      try { return await openCollectionFile(current.destination); }
      catch { warning = 'Opened the local copy. The saved collection file could not be read.'; }
    }
    return changeLibrary(draft => {
      const collection = draft.collections.find(item => item.id === id);
      if (!collection) throw new Error('Collection not found.');
      collection.closed = false;
      return { ...collection, warning };
    });
  });
  handle('open-collection', async () => {
    const chosen = await dialog.showOpenDialog(window, { title: 'Open a Papan collection', properties: ['openFile'],
      filters: [{ name: 'Papan collection or portable copy', extensions: ['papan', 'zip'] }] });
    if (chosen.canceled || !chosen.filePaths.length) return null;
    return openCollectionFile(chosen.filePaths[0]);
  });
  handle('export-collection', async input => {
    const snapshot = library.snapshot(), collection = snapshot.collections.find(item => item.id === input.id);
    if (!collection) throw new Error('Collection not found.');
    const filename = collection.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '') || 'collection';
    const extension = collection.vault ? 'papan' : 'zip';
    const chosen = await dialog.showSaveDialog(window, { title: 'Export a portable collection', buttonLabel: 'Export portable copy',
      defaultPath: path.join(app.getPath('documents'), `${filename}.${collection.vault ? 'papan' : 'papan.zip'}`),
      filters: [{ name: 'Portable Papan collection', extensions: [extension] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
    if (chosen.canceled || !chosen.filePath) return null;
    const file = chosen.filePath.toLowerCase().endsWith(`.${extension}`) ? chosen.filePath : `${chosen.filePath}.${extension}`;
    if (collection.vault) {
      const temporary = `${file}.${randomUUID()}.tmp`;
      try { await copyFile(library.protection.vaultPath(collection), temporary); await rename(temporary, file); }
      finally { await rm(temporary, { force: true }); }
      return { file, encrypted: true };
    }
    return job(input.requestId, signal => exportBundle(library.root, snapshot, collection, file, signal));
  });
  handle('open-source', async id => {
    const pin = library.snapshot().pins.find(item => item.id === id);
    if (!pin) throw new Error('Pin not found.');
    await shell.openExternal(webURL(pin.sourceUrl));
  });
  handle('open-folder', id => { const file = library.snapshot().collections.find(item => item.id === id)?.destination; return shell.openPath(file ? path.dirname(file) : library.root); });
}

async function collectUnusedMedia() {
  // Keep media referenced by the previous atomic snapshot as a practical recovery path.
  const { readdir } = await import('node:fs/promises');
  const used = new Set([...(library.snapshot().retainedMedia || []), ...library.snapshot().pins.map(pin => pin.folder), ...(library.snapshot().trash || []).flatMap(item => item.pins.map(({ pin }) => pin.folder))]);
  try {
    const previous = JSON.parse(await readFile(path.join(library.root, 'library.previous.json'), 'utf8'));
    for (const pin of previous.pins || []) used.add(pin.folder);
    for (const folder of previous.retainedMedia || []) used.add(folder);
    for (const entry of previous.trash || []) for (const { pin } of entry.pins) used.add(pin.folder);
  } catch (error) { if (error.code !== 'ENOENT') return; }
  for (const folder of await readdir(path.join(library.root, 'media'))) if (!used.has(folder)) await removeMedia(library.root, folder);
}

async function createWindow() {
  window = new BrowserWindow({ width: 1200, height: 820, minWidth: 560, minHeight: 400, backgroundColor: '#000000',
    title: 'Papan', icon: path.join(here, '..', 'assets', 'icon.png'), show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  if (process.platform !== 'darwin') window.setMenu(null);
  window.webContents.on('before-input-event', (_event, input) => {
    window.webContents.setIgnoreMenuShortcuts((input.control || input.meta) && !input.alt && !input.shift && ['t', 'w'].includes(input.key.toLowerCase()));
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const publishVisibility = () => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('papan:window-visibility', window.isVisible() && !window.isMinimized());
    }
  };
  for (const event of ['show', 'hide', 'minimize', 'restore']) window.on(event, publishVisibility);
  window.webContents.on('did-finish-load', publishVisibility);
  window.on('closed', () => { for (const controller of jobs.values()) controller.abort(); window = null; });
  window.once('ready-to-show', () => window.show());
  await window.loadURL('papan://app/index.html');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    library = await openLibrary(path.join(app.getPath('userData'), 'library'));
    try {
      const saved = JSON.parse(await readFile(path.join(library.root, 'browser-session.json'), 'utf8'));
      if (!BROWSER_SESSION_MODES.includes(saved.browser)) throw new Error('Invalid browser-session setting.');
      browserSession = saved.browser;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rm(path.join(library.root, 'staging'), { recursive: true, force: true });
    await collectUnusedMedia();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
    protocol.handle('papan', async request => {
      try {
        const url = new URL(request.url);
        let file;
        if (url.hostname === 'app' && ['/index.html', '/app.js', '/styles.css'].includes(url.pathname)) file = path.join(here, 'renderer', url.pathname.slice(1));
        else if (url.hostname === 'media' && /^\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(preview|original)$/i.test(url.pathname)) {
          const [, pinId, itemId, kind] = url.pathname.split('/');
          const item = library.snapshot().pins.find(pin => pin.id === pinId)?.items.find(item => item.id === itemId);
          if (item) file = library.protection.media(item, kind === 'original') || mediaLocation(library.root, item, kind === 'original');
        }
        else return new Response('Not found', { status: 404 });
        if (!file) return new Response('Not found', { status: 404 });
        return await fileResponse(file, request, types[typeof file === 'string' ? path.extname(file).toLowerCase() : file.ext] || 'application/octet-stream');
      } catch { return new Response('Not found', { status: 404 }); }
    });
    await session.defaultSession.clearCache();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    downloads = await openDownloadQueue(library.root, async (kind, payload, signal, progress) => {
      const result = await (kind === 'save' ? savePin(payload, signal, progress) : kind === 'collection' ? updateCollection(payload, signal, progress) : updatePin(payload, signal, progress));
      return { collectionId: result.collectionId, pinId: result.pin?.id };
    }, tasks => { if (window && !window.isDestroyed()) window.webContents.send('papan:downloads', tasks); }, {
      encode: (task, data) => library.protection.encodeTask(task, data || library.snapshot()),
      decode: (task, required) => library.protection.decodeTask(task, required),
    });
    phoneReceiver = await openPhoneReceiver(library.root, {
      run: (task, signal, progress) => savePhoneLink(task, { snapshot: library.snapshot, requireUnlocked: id => library.requireUnlocked(id), inspect: (url, signal) => inspectLink(url, signal, browserSession), save: savePin }, signal, progress),
      collection: (id, unlocked = true) => unlocked ? library.requireUnlocked(id) : library.snapshot().collections.find(c => c.id === id) || (() => { throw new Error('Choose a destination collection.'); })(),
      available: () => !protectionBusy, publish: publishPhoneInbox,
      codec: { encode: (task, data) => library.protection.encodeTask(task, data || library.snapshot()), decode: task => library.protection.decodeTask(task) },
    });
    installHandlers();
    await createWindow();
    phoneReceiver.pump();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Papan could not start', error.message); app.quit(); });
  let quitting = false;
  app.on('before-quit', event => {
    downloads?.stop();
    if (phoneReceiver && !quitting) {
      event.preventDefault();
      void phoneReceiver.stop().finally(() => { quitting = true; app.quit(); });
    }
  });
  app.on('will-quit', () => library?.protection.clear());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
