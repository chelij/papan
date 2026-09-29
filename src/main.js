import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { openLibrary, newCollection, collectionName, collectionSettings, pinDetails } from './library.js';
import { collectionContents, saveCollectionFile, readCollectionFile, mediaLocation } from './collection-files.js';
import { inspectLink, materialize, removeMedia, extractWorker, webURL } from './media.js';
import { openDownloadQueue } from './download-queue.js';
import { exportBundle, importBundle } from './portable.js';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName('Papan');
if (process.env.PAPAN_DATA_DIR) app.setPath('userData', path.resolve(process.env.PAPAN_DATA_DIR));
protocol.registerSchemesAsPrivileged([{ scheme: 'papan', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const inspections = new Map(), jobs = new Map();
let library, window, downloads;

async function changeLibrary(operation, saveId = null) {
  const restorations = [];
  return library.mutate(async draft => {
    const before = library.snapshot();
    const result = await operation(draft);
    for (const collection of draft.collections) {
      if (!collection.destination) continue;
      const previous = before.collections.find(item => item.id === collection.id);
      if (collection.id === saveId || collection.destination !== previous?.destination ||
          JSON.stringify(collectionContents(draft, collection, library.root)) !== JSON.stringify(previous ? collectionContents(before, previous, library.root) : null)) {
        for (const file of [collection.destination, `${collection.destination.slice(0, -path.extname(collection.destination).length)}.previous.papan`]) {
          let contents = null;
          try { contents = await readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          restorations.push({ file, contents });
        }
        collection.destinationRevision = await saveCollectionFile(library.root, draft, collection);
      }
      retainReferencedMedia(draft, draft.pins.filter(pin => pin.collectionId === collection.id));
    }
    return result;
  }, async () => {
    for (const { file, contents } of restorations.reverse()) {
      const temporary = `${file}.${randomUUID()}.rollback`;
      try {
        if (contents === null) await rm(file, { force: true });
        else { await writeFile(temporary, contents, { mode: 0o600 }); await rename(temporary, file); }
      } catch (error) {
        const recovery = path.join(library.root, 'recovery');
        await mkdir(recovery, { recursive: true });
        if (contents) await writeFile(path.join(recovery, `${randomUUID()}-${path.basename(file)}`), contents, { mode: 0o600 });
        throw new Error(`The collection destination became unavailable during recovery. Preserved copies are in ${recovery}. ${error.message}`);
      } finally { await rm(temporary, { force: true }).catch(() => {}); }
    }
  });
}

async function openCollectionFile(file) {
  if (file.toLowerCase().endsWith('.zip')) {
    const imported = await importBundle(library.root, file);
    try {
      return await changeLibrary(draft => { draft.collections.push(imported.collection); draft.pins.push(...imported.pins); return imported.collection; });
    } catch (error) { await removeMedia(library.root, imported.folder); throw error; }
  }
  return library.mutate(async draft => {
    const loaded = await readCollectionFile(file, draft);
    const index = draft.collections.findIndex(item => item.id === loaded.collection.id);
    if (index === -1) draft.collections.push(loaded.collection); else draft.collections[index] = loaded.collection;
    draft.pins = draft.pins.filter(pin => pin.collectionId !== loaded.collection.id).concat(loaded.pins);
    retainReferencedMedia(draft, loaded.pins);
    return loaded.collection;
  });
}

async function preparePin(input) {
  const inspection = inspections.get(input.inspectionId);
  if (!inspection || Date.now() - inspection.time > 30 * 60 * 1000) throw new Error('This preview expired. Paste the link again.');
  if (!Array.isArray(input.selectedIds) || !input.selectedIds.length || input.selectedIds.length > 50 || new Set(input.selectedIds).size !== input.selectedIds.length) throw new Error('Select between 1 and 50 items.');
  const data = inspection.data, items = data.items.filter(item => input.selectedIds.includes(item.id));
  if (items.length !== input.selectedIds.length) throw new Error('The selected items were not found.');
  const snapshot = library.snapshot();
  let target = input.collectionId ? snapshot.collections.find(item => item.id === input.collectionId) : snapshot.collections.find(item => !item.closed);
  if (input.collectionId && !target || target?.closed) throw new Error('Open the collection before adding a pin.');
  if (!target) target = await changeLibrary(draft => { const created = newCollection('collection 01'); draft.collections.push(created); return created; });
  if (snapshot.pins.some(pin => pin.collectionId === target.id && pin.sourceUrl === data.sourceUrl)) throw new Error('This link is already in this collection.');
  return { pin: { id: randomUUID(), collectionId: target.id, sourceUrl: data.sourceUrl, engine: data.engine,
    ...pinDetails({ ...input, title: input.title?.trim() || data.title }), author: data.author, text: data.text, items,
    coverId: items.some(item => item.id === input.coverId) ? input.coverId : items[0].id, createdAt: new Date().toISOString() } };
}

async function savePin({ pin }, signal, progress) {
  const snapshot = library.snapshot(), target = snapshot.collections.find(item => item.id === pin.collectionId);
  if (!target) throw new Error('The destination collection was removed.');
  if (snapshot.pins.some(item => item.collectionId === pin.collectionId && item.sourceUrl === pin.sourceUrl)) throw new Error('This link is already in this collection.');
  const saved = await materialize(pin, library.root, target.settings.mode === 'offline', signal, progress);
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
  const converted = [];
  try {
    const pins = settings.mode === 'offline' ? snapshot.pins.filter(pin => pin.collectionId === input.id && !pin.offline) : [];
    for (const [index, pin] of pins.entries()) {
      progress(`downloading originals · pin ${index + 1} of ${pins.length}`);
      converted.push(await materialize(pin, library.root, true, signal, message => progress(`pin ${index + 1} of ${pins.length} · ${message}`)));
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
  const details = pinDetails(input), snapshot = library.snapshot();
  const pin = snapshot.pins.find(pin => pin.id === input.id), target = snapshot.collections.find(item => item.id === input.collectionId);
  if (!pin || !target) throw new Error('The pin or collection no longer exists.');
  if (!pin.items.some(item => item.id === input.coverId)) throw new Error('Choose a cover from this pin.');
  if (snapshot.pins.some(item => item.id !== pin.id && item.collectionId === target.id && item.sourceUrl === pin.sourceUrl)) throw new Error('This link is already in the destination collection.');
  let saved;
  try {
    if (target.settings.mode === 'offline' && !pin.offline) saved = await materialize(pin, library.root, true, signal, progress);
    return await changeLibrary(draft => {
      signal?.throwIfAborted();
      const current = draft.pins.find(item => item.id === pin.id), destination = draft.collections.find(item => item.id === target.id);
      if (!current || !destination) throw new Error('The pin or destination was removed.');
      if (JSON.stringify(current) !== JSON.stringify(pin)) throw new Error('This pin changed while you were editing. Reopen its details and try again.');
      if (destination.settings.mode === 'offline' && !current.offline && !saved) throw new Error('The destination now requires originals. Retry this move.');
      if (draft.pins.some(item => item.id !== pin.id && item.collectionId === target.id && item.sourceUrl === pin.sourceUrl)) throw new Error('This link is already in the destination collection.');
      if (saved) Object.assign(current, { items: saved.items, folder: saved.folder, offline: true });
      Object.assign(current, details, { coverId: input.coverId, collectionId: target.id });
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
    try { return { ok: true, value: await action(input) }; }
    catch (error) { return { ok: false, error: error.name === 'AbortError' ? 'Cancelled.' : error.message }; }
  });
}

function installHandlers() {
  handle('library', () => library.snapshot());
  handle('cancel', id => { jobs.get(id)?.abort(); });
  handle('tools', () => extractWorker({ action: 'versions' }));
  handle('inspect', input => job(input.requestId, async signal => {
    const result = await inspectLink(input.url, signal);
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
    return downloads.add('save', payload, payload.pin.title);
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
  handle('enqueue-collection', input => {
    const payload = { id: input.id, name: collectionName(input.name), settings: collectionSettings(input.settings) };
    if (!library.snapshot().collections.some(item => item.id === payload.id)) throw new Error('Collection not found.');
    return downloads.add('collection', payload, `Download originals · ${payload.name}`);
  });
  handle('update-pin', input => job(input.requestId, (signal, progress) => updatePin(input, signal, progress)));
  handle('enqueue-pin', input => {
    const payload = { id: input.id, ...pinDetails(input), collectionId: input.collectionId, coverId: input.coverId };
    if (!library.snapshot().pins.some(item => item.id === input.id)) throw new Error('Pin not found.');
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
  handle('delete-collection', id => changeLibrary(draft => {
    const index = draft.collections.findIndex(item => item.id === id);
    if (index === -1) throw new Error('Collection not found.');
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
    return draft;
  }));
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
      if (collection.destination !== destination || input.chooseDestination) delete collection.destinationRevision;
      collection.destination = destination;
      collection.fileId ||= collection.id;
      return collection;
    }, current.id);
  });
  handle('close-collection', id => changeLibrary(draft => {
    const collection = draft.collections.find(item => item.id === id);
    if (!collection) throw new Error('Collection not found.');
    collection.closed = true;
  }));
  handle('reopen-collection', async id => {
    const current = library.snapshot().collections.find(item => item.id === id);
    if (!current) throw new Error('Collection not found.');
    let warning;
    if (current.destination) {
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
    const chosen = await dialog.showSaveDialog(window, { title: 'Export a portable collection', buttonLabel: 'Export portable copy',
      defaultPath: path.join(app.getPath('documents'), `${filename}.papan.zip`),
      filters: [{ name: 'Portable Papan collection', extensions: ['zip'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
    if (chosen.canceled || !chosen.filePath) return null;
    const file = chosen.filePath.toLowerCase().endsWith('.zip') ? chosen.filePath : `${chosen.filePath}.papan.zip`;
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
    title: 'Papan', icon: path.join(here, '..', 'assets', 'icon.png'), autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('closed', () => { for (const controller of jobs.values()) controller.abort(); window = null; });
  window.once('ready-to-show', () => window.show());
  await window.loadURL('papan://app/index.html');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    library = await openLibrary(path.join(app.getPath('userData'), 'library'));
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
          if (item) file = mediaLocation(library.root, item, kind === 'original');
        }
        else return new Response('Not found', { status: 404 });
        if (!file) return new Response('Not found', { status: 404 });
        if (!(await stat(file)).isFile()) return new Response('Not found', { status: 404 });
        const response = await net.fetch(pathToFileURL(file).href, { headers: request.headers });
        const headers = new Headers(response.headers);
        headers.set('Content-Type', types[path.extname(file).toLowerCase()] || 'application/octet-stream');
        headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(response.body, { status: response.status, headers });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    downloads = await openDownloadQueue(library.root, async (kind, payload, signal, progress) => {
      const result = await (kind === 'save' ? savePin(payload, signal, progress) : kind === 'collection' ? updateCollection(payload, signal, progress) : updatePin(payload, signal, progress));
      return { collectionId: result.collectionId, pinId: result.pin?.id };
    }, tasks => { if (window && !window.isDestroyed()) window.webContents.send('papan:downloads', tasks); });
    installHandlers();
    await createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Papan could not start', error.message); app.quit(); });
  app.on('before-quit', () => downloads?.stop());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
