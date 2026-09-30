import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { openLibrary, newCollection, defaultSettings, collectionName, collectionSettings, pinDetails } from '../src/library.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'papan-tabs-ui-'));
const library = await openLibrary(root), inspections = new Map(), checks = [], errors = [], saves = [], calls = [];
const source = newCollection('offline references', { mode: 'offline', density: 9, slideshowSeconds: 9, motion: false });
await library.mutate(draft => {
  draft.collections.push(source);
  draft.pins.push({ id: randomUUID(), collectionId: source.id, title: 'Existing reference', sourceUrl: 'https://example.com/existing', offline: true, engine: 'page', items: [{ id: randomUUID(), kind: 'text', text: 'Keep this saved reference.' }] });
});
let browser, page, failInspection = false, failQueue = false, cancelOpen = false;
const handlers = new Map(), main = await readFile('src/main.js', 'utf8');
const context = vm.createContext({
  inspections, library, changeLibrary: mutation => library.mutate(mutation), newCollection, randomUUID, pinDetails,
  handle: (name, handler) => handlers.set(name, handler),
  downloads: { async add(_kind, { pin }) {
    if (failQueue) { failQueue = false; throw new Error('Queue unavailable. Try again.'); }
    saves.push(pin); await library.mutate(draft => draft.pins.push({ ...pin, offline: false })); return randomUUID();
  } },
});
// Run the actual main-process preparation, queue registration/rollback, and reorder handlers.
vm.runInContext(main.slice(main.indexOf('async function preparePin('), main.indexOf('\nasync function savePin(')), context);
for (const [start, end] of [["  handle('enqueue-save',", "  handle('downloads',"], ["  handle('reorder',", "  handle('save-collection',"]]) {
  vm.runInContext(main.slice(main.indexOf(start), main.indexOf(end)), context);
}
const stored = () => readFile(path.join(root, 'library.json'), 'utf8');
const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
try {
  browser = await chromium.launch({ executablePath: process.env.PAPAN_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--headless', '--ozone-platform=headless', '--enable-automation'], env });
  const cdp = await browser.newBrowserCDPSession(), { arguments: args } = await cdp.send('Browser.getBrowserCommandLine');
  assert.ok(args.some(arg => arg.startsWith('--headless'))); assert.equal(args.filter(arg => arg.startsWith('--ozone-platform=')).at(-1), '--ozone-platform=headless');
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } }); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('tabsAPI', async (method, input) => {
    calls.push({ method, ...(method === 'reorder' ? { input } : {}) });
    if (method === 'library') return library.publicSnapshot();
    if (method === 'downloads') return [];
    if (method === 'tools') return {};
    if (method === 'createCollection') throw new Error('Opening a blank tab must not call createCollection.');
    if (method === 'updateCollection') return library.mutate(draft => Object.assign(draft.collections.find(c => c.id === input.id), { name: collectionName(input.name), settings: collectionSettings(input.settings) }));
    if (method === 'closeCollection') return library.mutate(draft => { draft.collections.find(c => c.id === input).closed = true; library.protection.lock(draft, input); });
    if (method === 'unlockCollection') return library.mutate(draft => library.protection.unlock(draft, input.id, input.password));
    if (method === 'lockCollection') return library.mutate(draft => library.protection.lock(draft, input.id));
    if (method === 'reopenCollection' || method === 'openCollection') {
      if (cancelOpen) { cancelOpen = false; return null; }
      const id = method === 'openCollection' ? source.id : input;
      await library.mutate(draft => { draft.collections.find(c => c.id === id).closed = false; });
      return library.publicSnapshot().collections.find(c => c.id === id);
    }
    if (method === 'inspect') {
      if (failInspection) { failInspection = false; throw new Error('Could not inspect this link.'); }
      const data = { id: randomUUID(), sourceUrl: input.url, title: 'Saved reference', engine: 'page', items: [{ id: randomUUID(), kind: 'text', text: 'A newly collected reference.' }] };
      inspections.set(data.id, { time: Date.now(), data }); return data;
    }
    if (method === 'enqueueSave') return handlers.get('enqueue-save')(input);
    if (method === 'reorder') return handlers.get('reorder')(input);
    throw new Error(`Unexpected tabs API: ${method}`);
  });
  await page.addInitScript(() => {
    window.papan = Object.fromEntries(['library', 'downloads', 'tools', 'createCollection', 'updateCollection', 'closeCollection', 'reopenCollection', 'openCollection', 'inspect', 'enqueueSave', 'reorder', 'unlockCollection', 'lockCollection'].map(method => [method, input => window.tabsAPI(method, input)]));
    window.papan.onDownloads = () => {}; window.papan.onProgress = () => {};
  });
  await page.goto(pathToFileURL(path.resolve('src/renderer/index.html')).href);
  const tabs = page.locator('.collection-tab'), selected = page.locator('.collection-tab[aria-selected="true"]');
  const ids = () => tabs.evaluateAll(nodes => nodes.map(node => node.dataset.collectionId));
  const paste = url => page.evaluate(url => { const data = new DataTransfer(); data.setData('text/plain', url); document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data })); }, url);
  await expect(selected).toHaveText('offline references');
  const original = await stored();
  await expect(page.locator('#toolbar')).toHaveCSS('border-bottom-color', 'rgb(255, 255, 255)');
  const plusBounds = await page.locator('#new-collection').boundingBox(), lastBounds = await tabs.last().boundingBox();
  assert.ok(plusBounds.x >= lastBounds.x + lastBounds.width && plusBounds.x - lastBounds.x - lastBounds.width < 45);
  await page.locator('#new-collection').click(); await expect(tabs).toHaveCount(2); await expect(selected).toHaveText('new tab');
  const firstBlank = await selected.getAttribute('data-collection-id');
  await expect(page.locator('#settings-dialog')).toBeHidden(); await expect(page.locator('#collection-settings')).toBeDisabled(); await expect(page.locator('#save-collection-file')).toBeDisabled();
  await page.keyboard.press('Control+s'); await page.keyboard.press('Control+,'); await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#start-collecting')).toBeVisible(); await expect(page.locator('#open-empty-collection')).toBeVisible();
  await page.keyboard.press('Control+t'); await expect(tabs).toHaveCount(3); await page.keyboard.press('Control+Tab'); await expect(selected).toHaveText('offline references');
  await page.keyboard.press('Control+Shift+Tab'); await expect(selected).toHaveText('new tab'); await page.keyboard.press('Control+w'); await expect(tabs).toHaveCount(2);
  await page.locator(`[data-close-collection="${firstBlank}"]`).click(); await expect(tabs).toHaveCount(1);
  assert.equal(await stored(), original); assert.equal(calls.filter(c => ['createCollection', 'closeCollection'].includes(c.method)).length, 0);
  await page.locator('#open-collection').click(); await expect(page.locator('[data-reopen-collection]')).toHaveCount(0); await page.keyboard.press('Escape');
  checks.push('opening, switching, closing, and save/settings shortcuts on blank tabs leave the library byte-for-byte unchanged and add no recent entries');

  await page.keyboard.press('Control+t'); await expect(tabs).toHaveCount(2); await paste('not a link'); await expect(page.locator('#add-dialog')).toBeHidden();
  failInspection = true; await paste('https://example.com/failed'); await expect(page.locator('#add-error')).toContainText('Could not inspect'); await page.keyboard.press('Escape');
  await paste('https://example.com/cancelled'); await expect(page.locator('#inspection')).toBeVisible(); await page.keyboard.press('Escape');
  assert.equal(await stored(), original); await page.reload(); await expect(tabs).toHaveCount(1); assert.equal(await stored(), original);
  checks.push('invalid links, failed inspections, cancelled pastes, and restarting with unused tabs create no collection');

  await page.keyboard.press('Control+t'); const pendingId = await selected.getAttribute('data-collection-id');
  await page.keyboard.press('Control+t'); const otherBlank = await selected.getAttribute('data-collection-id');
  await page.locator(`#collection-tab-${pendingId}`).click();
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/new-collection-tab.png' });
  await paste('https://example.com/new-reference'); await expect(page.locator('#inspection')).toBeVisible();
  await expect(page.locator('#save-collection')).toHaveValue(''); assert.equal(await stored(), original);
  await page.locator('.pin-metadata summary').click();
  await page.locator('#pin-tags').fill(Array.from({ length: 21 }, (_, i) => `tag${i}`).join(',')); await page.locator('#save-pin').click();
  await expect(page.locator('#add-error')).toContainText('20 tags'); assert.equal(await stored(), original);
  await page.locator('#pin-tags').fill(''); failQueue = true; await page.locator('#save-pin').click(); await expect(page.locator('#add-error')).toContainText('Queue unavailable');
  assert.equal(await stored(), original); await expect(tabs).toHaveCount(3);
  await page.locator('#save-pin').click(); await expect(page.locator('#add-dialog')).toBeHidden(); await expect(page.locator('.pin')).toContainText('Saved reference');
  const savedId = await selected.getAttribute('data-collection-id');
  assert.notEqual(savedId, pendingId); assert.deepEqual(await ids(), [source.id, savedId, otherBlank]); assert.equal(library.snapshot().collections.length, 2);
  assert.equal(saves.at(-1).collectionId, savedId); assert.deepEqual(library.snapshot().collections.find(c => c.id === savedId).settings, defaultSettings);
  await expect(selected).toHaveText('new collection');
  await page.locator('#collection-settings').click(); await page.locator('#collection-name').fill('reading list'); await page.locator('#slide-seconds').press('End'); await page.keyboard.press('Escape');
  await expect(selected).toHaveText('reading list'); assert.equal(library.snapshot().collections.find(c => c.id === savedId).settings.slideshowSeconds, 10);
  checks.push('first save creates exactly one default collection in the same tab position; invalid metadata and queue errors leave no orphan; settings work afterward');

  await page.locator(`#collection-tab-${otherBlank}`).click(); await paste('https://example.com/existing-target'); await expect(page.locator('#inspection')).toBeVisible();
  await page.locator('#save-collection').selectOption(source.id); await page.locator('#save-pin').click(); await expect(page.locator('#add-dialog')).toBeHidden(); await expect(selected).toHaveText('offline references');
  assert.equal(library.snapshot().collections.length, 2); assert.equal(saves.at(-1).collectionId, source.id); await expect(tabs).toHaveCount(2);
  checks.push('choosing an existing collection for a pasted link uses that collection without leaving an empty tab or saved collection');

  await page.keyboard.press('Control+t'); const cancelledOpen = await selected.getAttribute('data-collection-id');
  cancelOpen = true; await page.locator('#open-empty-collection').click(); await page.locator('#browse-collection').click(); await expect(page.locator('#collections-dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(selected).toHaveAttribute('data-collection-id', cancelledOpen);
  await page.locator('#open-empty-collection').click(); await page.locator('#browse-collection').click(); await expect(selected).toHaveText('offline references'); await expect(tabs).toHaveCount(2);
  await page.keyboard.press('Control+w'); await expect(tabs).toHaveCount(1); assert.equal(library.snapshot().collections.find(c => c.id === source.id).closed, true);
  await page.keyboard.press('Control+t'); await page.locator('#open-empty-collection').click(); await expect(page.locator('[data-reopen-collection]')).toHaveCount(1);
  await page.locator(`[data-reopen-collection="${source.id}"]`).click(); await expect(selected).toHaveText('offline references'); await expect(tabs).toHaveCount(2);
  checks.push('file-picker cancellation preserves the blank tab; opening/reopening an existing collection replaces it without history pollution');

  await page.keyboard.press('Control+t'); await page.keyboard.press('Control+t');
  const beforeOrder = await ids(), moving = beforeOrder.at(-1), beforeReorder = await stored(), reorderCalls = calls.filter(c => c.method === 'reorder').length;
  await selected.press('Alt+ArrowLeft'); await expect.poll(ids).toEqual([...beforeOrder.slice(0, -2), moving, beforeOrder.at(-2)]);
  assert.equal(await stored(), beforeReorder); assert.equal(calls.filter(c => c.method === 'reorder').length, reorderCalls);
  const order = await ids(), firstReal = order.find(id => !id.startsWith('new-tab-')), index = order.indexOf(firstReal);
  await page.locator(`#collection-tab-${firstReal}`).press('Alt+ArrowRight');
  const moved = order.filter(id => id !== firstReal); moved.splice(index + 1, 0, firstReal); await expect.poll(ids).toEqual(moved);
  for (const call of calls.filter(c => c.method === 'reorder')) { assert.ok(!call.input.id.startsWith('new-tab-')); assert.ok(!call.input.beforeId?.startsWith('new-tab-')); }
  assert.deepEqual(library.snapshot().collections.filter(c => !c.closed).map(c => c.id), moved.filter(id => !id.startsWith('new-tab-')));
  const beforeMany = await stored();
  for (let count = 4; count < 11; count++) { await page.keyboard.press('Control+t'); await expect(tabs).toHaveCount(count + 1); }
  for (const width of [1200, 781, 560]) {
    await page.setViewportSize({ width, height: 800 }); await expect(page.locator('#new-collection')).toBeInViewport(); await expect(selected).toBeInViewport();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const button of await page.locator('.toolbar-actions button:visible').all()) await expect(button).toBeInViewport();
  }
  await expect(page.locator('#toast')).toBeHidden(); await page.screenshot({ path: 'artifacts/new-collection-tabs-narrow.png' });
  assert.equal(await stored(), beforeMany); await page.reload(); await expect(tabs).toHaveCount(2); assert.equal(await stored(), beforeMany);
  checks.push('temporary tabs reorder in memory alongside saved tabs, remain usable at 560px, and disappear on restart without persisting');

  await page.setViewportSize({ width: 1200, height: 800 });
  const locked = newCollection('locked reference'); locked.closed = true;
  await library.mutate(async draft => { draft.collections.push(locked); await library.protection.setPassword(draft, locked.id, 'fixture password'); });
  await library.mutate(draft => library.protection.lock(draft, locked.id));
  await page.reload(); await expect(tabs).toHaveCount(2); await page.keyboard.press('Control+t'); const unlockBlank = await selected.getAttribute('data-collection-id');
  await page.locator('#open-empty-collection').click(); await page.locator(`[data-reopen-collection="${locked.id}"]`).click(); await expect(page.locator('#password-dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(selected).toHaveAttribute('data-collection-id', unlockBlank); assert.equal(library.snapshot().collections.length, 3);
  await page.locator(`#collection-tab-${locked.id}`).click(); await page.locator('#collection-password').fill('fixture password'); await page.locator('#submit-password').click();
  await expect(selected).toHaveAttribute('data-collection-id', locked.id); await expect(page.locator(`#collection-tab-${unlockBlank}`)).toHaveCount(1);
  await page.locator('#lock-collection').click(); await expect(page.locator('#lock-collection')).toBeHidden();
  await page.locator(`#collection-tab-${unlockBlank}`).click(); await page.locator(`[data-close-collection="${locked.id}"]`).click();
  await page.locator('#open-empty-collection').click(); await page.locator(`[data-reopen-collection="${locked.id}"]`).click(); await page.locator('#collection-password').fill('fixture password'); await page.locator('#submit-password').click();
  await expect(selected).toHaveAttribute('data-collection-id', locked.id); await expect(page.locator(`#collection-tab-${unlockBlank}`)).toHaveCount(0); assert.equal(library.snapshot().collections.length, 3);
  checks.push('cancelled password entry retains the blank tab; switching to a locked tab preserves it; opening an encrypted collection replaces it only after unlock');
  assert.equal(calls.filter(c => c.method === 'createCollection').length, 0); assert.deepEqual(errors, []);
  await writeFile('artifacts/tabs-check.json', JSON.stringify({ status: 'passed', display: 'isolated headless Chromium', checks, limits: 'Actual renderer/library/crypto and production preparation, enqueue/rollback, and reorder handlers. IPC, inspection, downloads and file picker stubbed; native application menu not exercised.' }, null, 2) + '\n');
  console.log(checks.join('\n'));
} catch (error) {
  if (page && !page.isClosed()) { await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/tabs-failure.png' }); }
  throw error;
} finally { await browser?.close(); library.protection.clear(); await rm(root, { recursive: true, force: true }); }
