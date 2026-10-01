import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { newCollection, collectionName, collectionSettings } from '../src/library.js';

// Check the real settings renderer without opening a window on the desktop.
const collection = newCollection('inspiration');
const state = { collections: [collection], pins: [] }, calls = [], errors = [], checks = [];
let failNextSave = false, browser;
const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
for (let index = 0; index < 12; index++) {
  const itemId = randomUUID(), color = ['#637c64', '#bb9271', '#7b8391'][index % 3];
  state.pins.push({ id: randomUUID(), collectionId: collection.id, title: `reference ${index + 1}`, sourceUrl: `https://example.com/${index}`, coverId: itemId, offline: true,
    items: [{ id: itemId, kind: 'image', width: 400, height: index % 2 ? 500 : 300, url: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${index % 2 ? 500 : 300}"><rect width="100%" height="100%" fill="${color}"/></svg>`) }] });
}
try {
  browser = await chromium.launch({ executablePath: process.env.PAPAN_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--headless', '--ozone-platform=headless', '--enable-automation'], env });
  const cdp = await browser.newBrowserCDPSession(), { arguments: args } = await cdp.send('Browser.getBrowserCommandLine');
  assert.ok(args.some(arg => arg.startsWith('--headless'))); assert.equal(args.filter(arg => arg.startsWith('--ozone-platform=')).at(-1), '--ozone-platform=headless');
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } }); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('readSettingsLibrary', () => structuredClone(state));
  await page.exposeFunction('saveSettings', input => {
    if (failNextSave) { failNextSave = false; throw new Error('Destination unavailable. Your changes have not been saved.'); }
    Object.assign(state.collections.find(c => c.id === input.id), { name: collectionName(input.name), settings: collectionSettings(input.settings) });
    calls.push(structuredClone(input)); return structuredClone(state.collections.find(c => c.id === input.id));
  });
  await page.exposeFunction('createSettingsCollection', input => { const c = newCollection(input.name, input.settings); state.collections.push(c); return structuredClone(c); });
  await page.addInitScript(() => {
    window.papan = { library: () => window.readSettingsLibrary(), updateCollection: input => window.saveSettings(input), createCollection: input => window.createSettingsCollection(input),
      browserSession: async () => 'auto', setBrowserSession: async value => value,
      downloads: async () => [], onDownloads() {}, onProgress() {}, cancel: async () => {}, tools: async () => ({ 'gallery-dl': '1.32.14', 'yt-dlp': '2026.08.19', Instaloader: '4.15.3' }) };
  });
  await page.goto(pathToFileURL(path.resolve('src/renderer/index.html')).href);
  await page.locator('#collection-settings').click();
  const dialog = page.locator('#settings-dialog'), tab = name => page.getByRole('tab', { name, exact: true });
  const metrics = () => dialog.evaluate(d => { const f = document.querySelector('#settings-form'), r = d.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, clientHeight: f.clientHeight, contentHeight: f.scrollHeight, horizontalOverflow: f.scrollWidth > f.clientWidth }; });
  const original = await metrics(), sections = {};
  assert.ok(original.height <= 500); assert.equal(original.horizontalOverflow, false);
  await mkdir('artifacts', { recursive: true });
  for (const name of ['General', 'Storage', 'Privacy']) {
    await tab(name).click();
    const box = await metrics(); sections[name] = box;
    for (const key of ['x', 'y', 'width', 'height']) assert.equal(box[key], original[key], `${name} ${key}`);
    assert.equal(box.horizontalOverflow, false);
    assert.equal(box.contentHeight, box.clientHeight, `${name} fits without scrolling`);
    await expect(page.locator('#settings-form [role="tabpanel"]:visible')).toHaveCount(1);
    await dialog.screenshot({ path: `artifacts/settings-${name.toLowerCase()}.png` });
  }
  checks.push('three compact sections keep identical panel bounds with no horizontal overflow');
  await tab('General').focus(); await page.keyboard.press('ArrowRight'); await expect(tab('Storage')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#collection-mode')).toBeFocused();
  await tab('Privacy').focus(); await page.keyboard.press('Home'); await expect(tab('General')).toBeFocused();
  await page.keyboard.press('End'); await expect(tab('Privacy')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(tab('General')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#collection-name')).toBeFocused();
  const nameWidth = (await page.locator('#collection-name').boundingBox()).width;
  await page.locator('.shortcuts summary').click();
  assert.equal((await page.locator('#collection-name').boundingBox()).width, nameWidth);
  assert.equal((await metrics()).width, original.width); await page.locator('.shortcuts summary').click();
  await page.locator('#collection-name').fill('saved design'); await page.locator('#preview-size').press('Home');
  await tab('Storage').click(); await page.locator('#collection-mode').selectOption('offline'); await tab('Privacy').click();
  assert.equal(calls.length, 0, 'switching sections does not save early');
  await page.locator('[data-close="settings-dialog"]').click(); await expect(dialog).toBeHidden();
  assert.equal(collection.name, 'saved design'); assert.equal(collection.settings.density, 10); assert.equal(collection.settings.mode, 'offline');
  checks.push('keyboard navigation, stable scrollbar width, live drafts, and autosave across sections');
  await page.locator('#collection-settings').click(); await page.locator('#collection-name').fill(''); await tab('Storage').click();
  await page.locator('[data-close="settings-dialog"]').click(); await expect(dialog).toBeVisible();
  await expect(tab('General')).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('#collection-name')).toBeFocused();
  await expect(page.locator('#discard-settings')).toBeVisible(); assert.equal(calls.length, 1);
  await page.locator('#collection-name').fill('repaired'); await tab('Privacy').click(); await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden(); assert.equal(collection.name, 'repaired');
  checks.push('closing another section reveals invalid fields; Escape still saves corrected drafts');
  await page.locator('#collection-settings').click(); await page.locator('#collection-name').fill('outside close'); await tab('Storage').click();
  await page.mouse.click(40, 140); await expect(dialog).toBeHidden(); assert.equal(collection.name, 'outside close'); await expect(page.locator('#viewer')).toBeHidden();
  await page.locator('#collection-settings').click(); await page.locator('#collection-name').fill('unsaved draft'); await tab('Storage').click();
  failNextSave = true; await page.locator('[data-close="settings-dialog"]').click();
  await expect(page.locator('#settings-error')).toContainText('Destination unavailable'); await expect(dialog).toBeVisible();
  assert.equal((await metrics()).height, original.height); assert.equal(collection.name, 'outside close');
  await tab('General').click(); await expect(page.locator('#collection-name')).toHaveValue('unsaved draft'); await page.locator('#discard-settings').click(); await expect(dialog).toBeHidden();
  checks.push('outside dismissal saves; failed saves retain drafts and keep the panel stable');
  await page.locator('.tile-main').first().click(); await page.locator('#edit-pin').click();
  await page.locator('#edit-collection').selectOption(''); await expect(tab('Privacy')).toBeHidden();
  await page.locator('#collection-name').fill('new offline board'); await tab('Storage').click(); await page.locator('#collection-mode').selectOption('offline');
  await page.locator('#create-collection').click(); await expect(dialog).toBeHidden();
  assert.equal(state.collections.at(-1).settings.mode, 'offline');
  await page.locator('[data-close="pin-editor"]').click();
  checks.push('new collections retain settings across General and Storage');
  await page.setViewportSize({ width: 560, height: 400 }); await page.locator('#collection-settings').click();
  const small = await metrics(); assert.ok(small.y >= 0 && small.y + small.height <= 400);
  await page.locator('#slide-seconds').scrollIntoViewIfNeeded();
  const scrolled = await metrics(); assert.equal(scrolled.x, small.x); assert.equal(scrolled.width, small.width);
  await expect(page.locator('[data-close="settings-dialog"]')).toBeInViewport(); await expect(page.locator('#settings-tabs')).toBeInViewport(); await expect(page.locator('.settings-footer')).toBeInViewport();
  await tab('Privacy').click(); assert.equal((await metrics()).height, small.height); assert.equal((await metrics()).horizontalOverflow, false);
  await dialog.screenshot({ path: 'artifacts/settings-short-window.png' });
  checks.push('short windows scroll only the content and keep tabs, close control, and footer visible');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/settings-check.json', JSON.stringify({ status: 'passed', display: 'isolated headless Chromium', sections, small, checks, limits: 'Actual renderer with stubbed preload; native Electron window not exercised.' }, null, 2) + '\n');
  console.log(JSON.stringify({ sections, small, checks }, null, 2));
} finally { await browser?.close(); }
