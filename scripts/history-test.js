import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { openLibrary, newCollection } from '../src/library.js';
import { saveCollectionFile } from '../src/collection-files.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'papan-history-ui-')), root = path.join(directory, 'library');
let library = await openLibrary(root), browser, page, failNext = false;
const current = newCollection('current board'), local = newCollection('saved references'), protectedCollection = newCollection('private references'), external = newCollection('saved file');
for (const c of [local, protectedCollection, external]) c.closed = true;
external.destination = path.join(directory, 'references.papan');
const textPin = id => { const itemId = randomUUID(); return { id: randomUUID(), collectionId: id, title: 'Keep this reference', sourceUrl: 'https://example.com/reference', engine: 'page', offline: false, coverId: itemId, items: [{ id: itemId, kind: 'text', text: 'Saved content stays available.' }] }; };
const pin = textPin(local.id), secret = textPin(protectedCollection.id), removed = textPin(local.id);
const folder = randomUUID(), media = path.join(root, 'media', folder, 'preview.png');
await mkdir(path.dirname(media));
await writeFile(media, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf2kAAAAASUVORK5CYII=', 'base64'));
pin.folder = folder; pin.items.push({ id: randomUUID(), kind: 'image', previewFile: `${folder}/preview.png`, width: 1, height: 1 });
await library.mutate(async draft => {
  draft.collections.push(current, local, protectedCollection, external);
  draft.pins.push(pin, secret);
  draft.trash = [{ id: randomUUID(), pins: [{ pin: removed, index: 0 }], createdAt: new Date().toISOString() }];
  external.destinationRevision = await saveCollectionFile(root, draft, external);
  await library.protection.setPassword(draft, protectedCollection.id, 'fixture password');
});
await library.mutate(draft => library.protection.lock(draft, protectedCollection.id));
const before = library.snapshot(), diskBefore = await readFile(path.join(root, 'library.json'), 'utf8');
const vault = path.join(root, 'vaults', before.collections.find(c => c.id === protectedCollection.id).vault.file);
const files = await Promise.all([media, vault, external.destination].map(file => readFile(file)));
const checks = [], errors = [], handlers = new Map(), main = await readFile('src/main.js', 'utf8');
const context = vm.createContext({
  library, handle: (name, handler) => handlers.set(name, handler),
  changeLibrary: mutation => { if (failNext) { failNext = false; throw new Error('Could not save history. Try again.'); } return library.mutate(mutation); },
  protectCollection: (input, action) => library.mutate(draft => action(draft, input.id)),
});
vm.runInContext(main.slice(main.indexOf("  handle('clear-collection-history',"), main.indexOf("  handle('open-collection',")), context);
const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
try {
  browser = await chromium.launch({ executablePath: process.env.PAPAN_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--headless', '--ozone-platform=headless', '--enable-automation'], env });
  const cdp = await browser.newBrowserCDPSession(), { arguments: args } = await cdp.send('Browser.getBrowserCommandLine');
  assert.ok(args.some(arg => arg.startsWith('--headless'))); assert.equal(args.filter(arg => arg.startsWith('--ozone-platform=')).at(-1), '--ozone-platform=headless');
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } }); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('historyAPI', async (method, input) => {
    if (method === 'library') return library.publicSnapshot();
    if (method === 'downloads') return [];
    if (method === 'openCollection') return null;
    if (method === 'clearCollectionHistory') return handlers.get('clear-collection-history')();
    if (method === 'closeCollection') return handlers.get('close-collection')(input);
    if (method === 'reopenCollection') return handlers.get('reopen-collection')(input);
    if (method === 'unlockCollection') return library.mutate(draft => library.protection.unlock(draft, input.id, input.password));
    throw new Error(`Unexpected history API: ${method}`);
  });
  await page.addInitScript(() => {
    window.papan = Object.fromEntries(['library', 'downloads', 'openCollection', 'clearCollectionHistory', 'closeCollection', 'reopenCollection', 'unlockCollection'].map(method => [method, input => window.historyAPI(method, input)]));
    window.papan.onDownloads = () => {}; window.papan.onProgress = () => {};
  });
  await page.goto(pathToFileURL(path.resolve('src/renderer/index.html')).href);
  const dialog = page.locator('#collections-dialog'), entries = page.locator('[data-reopen-collection]'), scope = page.getByLabel('Collections to show'), clear = page.getByRole('button', { name: 'clear history', exact: true });
  await page.locator('#open-collection').click(); await expect(entries).toHaveCount(3); await expect(clear).toBeEnabled();
  failNext = true; await clear.click(); await expect(page.locator('#collection-file-error')).toContainText('Could not save history');
  await expect(entries).toHaveCount(3); await expect(clear).toBeEnabled(); assert.equal(await readFile(path.join(root, 'library.json'), 'utf8'), diskBefore);
  checks.push('failed history saves keep every recent entry and allow retry');

  await clear.click(); await expect(entries).toHaveCount(0); await expect(clear).toBeDisabled(); await expect(scope).toBeFocused();
  await expect(page.locator('#collection-file-status')).toContainText('History cleared');
  const cleared = library.snapshot(); assert.deepEqual(cleared.collections, before.collections); assert.deepEqual(cleared.pins, before.pins); assert.deepEqual(cleared.trash, before.trash);
  assert.deepEqual(cleared.hiddenRecentCollections, [local.id, protectedCollection.id, external.id]);
  assert.deepEqual(await Promise.all([media, vault, external.destination].map(file => readFile(file))), files);
  await page.locator('#trash-section summary').click(); await expect(page.locator('[data-restore]')).toHaveCount(1); await page.locator('#trash-section summary').click();
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/collection-history-cleared.png' });
  checks.push('clear history changes only visibility metadata; collections, pins, removal history, saved media, encrypted vault, and external file remain intact');

  await scope.selectOption('all'); await expect(entries).toHaveCount(4); await expect(clear).toBeHidden();
  await expect(page.locator(`[data-reopen-collection="${protectedCollection.id}"]`)).toContainText('locked');
  await page.screenshot({ path: 'artifacts/collection-history-all.png' });
  await page.setViewportSize({ width: 560, height: 600 });
  assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)); await expect(scope).toBeInViewport();
  await page.keyboard.press('Escape');
  for (const id of ['collection-settings', 'save-collection-file', 'toggle-search']) await expect(page.locator(`#${id}`)).toBeEnabled();
  await page.setViewportSize({ width: 1200, height: 800 });
  library.protection.clear(); library = await openLibrary(root); context.library = library;
  await page.reload(); await page.locator('#open-collection').click(); await expect(entries).toHaveCount(0); await expect(clear).toBeDisabled();
  await page.locator('#browse-collection').click(); await expect(dialog).toBeVisible(); await expect(clear).toBeDisabled(); await expect(scope).toBeEnabled();
  await scope.selectOption('all'); await expect(entries).toHaveCount(4);
  checks.push('cleared history survives a real library reopen; all collections remain accessible, including locked ones; cancelled file picking keeps controls usable');

  await page.locator(`[data-reopen-collection="${local.id}"]`).click(); await expect(dialog).toBeHidden();
  await expect(page.locator('.collection-tab[aria-selected="true"]')).toHaveText(local.name); await expect(page.locator('.pin')).toHaveCount(1);
  await page.keyboard.press('Control+w'); await page.locator('#open-collection').click(); await expect(entries).toHaveCount(1); await expect(clear).toBeEnabled();
  await expect(entries).toHaveAttribute('data-reopen-collection', local.id);
  await scope.selectOption('all'); await page.locator(`[data-reopen-collection="${protectedCollection.id}"]`).click();
  await expect(page.locator('#password-dialog')).toBeVisible(); await page.locator('#collection-password').fill('fixture password'); await page.locator('#submit-password').click();
  await expect(page.locator('.collection-tab[aria-selected="true"]')).toHaveText(protectedCollection.name); await expect(page.locator('.pin')).toHaveCount(1);
  await page.keyboard.press('Control+w'); await page.locator('#open-collection').click(); await expect(entries).toHaveCount(2);
  assert.equal(library.snapshot().collections.length, 4);
  checks.push('reopening and closing cleared collections adds only those collections back to recent history; protected contents still unlock correctly');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/history-check.json', JSON.stringify({ status: 'passed', display: 'isolated headless Chromium', checks, limits: 'Actual renderer, library, crypto and production clear/close/reopen handlers; IPC, file picker and main-process save/cache wrappers stubbed. Native Electron window not exercised.' }, null, 2) + '\n');
  console.log(checks.join('\n'));
} catch (error) {
  if (page && !page.isClosed()) { await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/history-failure.png' }); }
  throw error;
} finally { await browser?.close(); library.protection.clear(); await rm(directory, { recursive: true, force: true }); }
