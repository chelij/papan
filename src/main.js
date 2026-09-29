import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, realpath, rm, stat } from 'node:fs/promises';
import { openLibrary, newCollection, collectionName, collectionSettings } from './library.js';
import { collectionContents, saveCollectionFile, readCollectionFile, mediaLocation } from './collection-files.js';
import { inspectLink, materialize, removeMedia, extractWorker, webURL } from './media.js';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName('Papan');
if (process.env.PAPAN_DATA_DIR) app.setPath('userData', path.resolve(process.env.PAPAN_DATA_DIR));
protocol.registerSchemesAsPrivileged([{ scheme: 'papan', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const inspections = new Map(), jobs = new Map();
let library, window;

async function changeLibrary(operation, saveId = null) {
  return library.mutate(async draft => {
    const before = library.snapshot();
    const result = await operation(draft);
    for (const collection of draft.collections) {
      if (!collection.destination) continue;
      const previous = before.collections.find(item => item.id === collection.id);
      if (collection.id === saveId || collection.destination !== previous?.destination ||
          JSON.stringify(collectionContents(draft, collection, library.root)) !== JSON.stringify(previous ? collectionContents(before, previous, library.root) : null)) {
        collection.destinationRevision = await saveCollectionFile(library.root, draft, collection);
      }
      retainReferencedMedia(draft, draft.pins.filter(pin => pin.collectionId === collection.id));
    }
    return result;
  });
}

async function openCollectionFile(file) {
  return library.mutate(async draft => {
    const loaded = await readCollectionFile(file, draft);
    const index = draft.collections.findIndex(item => item.id === loaded.collection.id);
    if (index === -1) draft.collections.push(loaded.collection); else draft.collections[index] = loaded.collection;
    draft.pins = draft.pins.filter(pin => pin.collectionId !== loaded.collection.id).concat(loaded.pins);
    retainReferencedMedia(draft, loaded.pins);
    return loaded.collection;
  });
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
  handle('save', input => job(input.requestId, (signal, progress) => changeLibrary(async draft => {
    const inspection = inspections.get(input.inspectionId);
    if (!inspection || Date.now() - inspection.time > 30 * 60 * 1000) throw new Error('This preview expired. Paste the link again.');
    if (!Array.isArray(input.selectedIds) || !input.selectedIds.length || input.selectedIds.length > 50 || new Set(input.selectedIds).size !== input.selectedIds.length) throw new Error('Select between 1 and 50 items.');
    const data = inspection.data;
    const items = data.items.filter(item => input.selectedIds.includes(item.id));
    if (items.length !== input.selectedIds.length) throw new Error('The selected items were not found.');
    const collection = input.collectionId ? draft.collections.find(item => item.id === input.collectionId) : draft.collections.find(item => !item.closed) || newCollection('collection 01');
    if (!collection || collection.closed) throw new Error('Open the collection before adding a pin.');
    if (draft.pins.some(pin => pin.collectionId === collection.id && pin.sourceUrl === data.sourceUrl)) throw new Error('This link is already in this collection.');
    const pin = { id: randomUUID(), collectionId: collection.id, sourceUrl: data.sourceUrl, engine: data.engine,
      title: (typeof input.title === 'string' && input.title.trim() ? input.title.trim() : data.title).slice(0, 200),
      author: data.author, text: data.text, items, coverId: items.some(item => item.id === input.coverId) ? input.coverId : items[0].id,
      createdAt: new Date().toISOString() };
    const saved = await materialize(pin, library.root, collection.settings.mode === 'offline', signal, progress);
    signal.throwIfAborted();
    if (!draft.collections.some(item => item.id === collection.id)) draft.collections.push(collection);
    draft.pins.push(saved);
    return { pin: saved, collectionId: collection.id };
  })));
  handle('create-collection', input => changeLibrary(draft => {
    const collection = newCollection(input.name, input.settings);
    draft.collections.push(collection);
    return collection;
  }));
  handle('update-collection', input => job(input.requestId, (signal, progress) => changeLibrary(async draft => {
    const collection = draft.collections.find(item => item.id === input.id);
    if (!collection) throw new Error('Collection not found.');
    const settings = collectionSettings(input.settings);
    const name = collectionName(input.name);
    const converted = [];
    try {
      if (settings.mode === 'offline') {
        const pins = draft.pins.filter(pin => pin.collectionId === input.id && !pin.offline);
        for (const [index, pin] of pins.entries()) {
          progress(`saving pin ${index + 1} of ${pins.length} offline…`);
          converted.push(await materialize(pin, library.root, true, signal));
        }
      }
      signal.throwIfAborted();
      for (const updated of converted) draft.pins[draft.pins.findIndex(pin => pin.id === updated.id)] = updated;
      collection.name = name;
      collection.settings = settings;
    } catch (error) {
      for (const pin of converted) await removeMedia(library.root, pin.folder);
      throw error;
    }
    return collection;
  })));
  handle('delete-pin', async id => {
    await changeLibrary(draft => { draft.pins = draft.pins.filter(pin => pin.id !== id); });
  });
  handle('delete-collection', async id => {
    await changeLibrary(draft => {
      draft.pins = draft.pins.filter(pin => pin.collectionId !== id);
      draft.collections = draft.collections.filter(collection => collection.id !== id);
    });
  });
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
      filters: [{ name: 'Papan collection', extensions: ['papan'] }] });
    if (chosen.canceled || !chosen.filePaths.length) return null;
    return openCollectionFile(chosen.filePaths[0]);
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
  const used = new Set([...(library.snapshot().retainedMedia || []), ...library.snapshot().pins.map(pin => pin.folder)]);
  try {
    const previous = JSON.parse(await readFile(path.join(library.root, 'library.previous.json'), 'utf8'));
    for (const pin of previous.pins || []) used.add(pin.folder);
    for (const folder of previous.retainedMedia || []) used.add(folder);
  } catch (error) { if (error.code !== 'ENOENT') return; }
  for (const folder of await readdir(path.join(library.root, 'media'))) if (!used.has(folder)) await removeMedia(library.root, folder);
}

async function createWindow() {
  window = new BrowserWindow({ width: 1200, height: 820, minWidth: 560, minHeight: 400, backgroundColor: '#000000',
    title: 'Papan', autoHideMenuBar: true, show: false,
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
    installHandlers();
    await createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Papan could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
