import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { newCollection } from '../src/library.js';

const data = await mkdtemp(path.join(os.tmpdir(), 'papan-interactions-'));
const collections = [newCollection('inspiration'), newCollection('saved offline', { mode: 'offline' }), newCollection('ideas')];
const folder = randomUUID(), directory = path.join(data, 'library', 'media', folder);
await mkdir(directory, { recursive: true });
const ratios = [[9, 16], [4, 3], [16, 9], [1, 1], [3, 2], [2, 3], [3, 1], [5, 4]];
const pins = [];
for (const [index, [w, h]] of ratios.entries()) {
  const file = `${index}.svg`, itemId = randomUUID();
  await writeFile(path.join(directory, file), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * 100} ${h * 100}"><rect width="100%" height="100%" fill="hsl(${index * 43 + 10} 22% 31%)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-size="70">${w}:${h}</text></svg>`);
  pins.push({ id: randomUUID(), collectionId: collections[0].id, title: `pin ${index + 1}`, sourceUrl: `https://example.com/${index}`, folder,
    coverId: itemId, items: [{ id: itemId, kind: 'image', previewFile: `${folder}/${file}`, previewWidth: w * 100, previewHeight: h * 100 }] });
}
// Drag an album whose cover differs from the collection's average media shape.
pins[0].items.push(...Array.from({ length: 3 }, () => ({ ...pins[1].items[0], id: randomUUID() })));
const mediaRatios = pins.flatMap(pin => pin.items.map(item => item.previewWidth / item.previewHeight));
const collectionRatio = mediaRatios.reduce((sum, ratio) => sum + ratio, 0) / mediaRatios.length;
const otherPin = { ...pins[0], id: randomUUID(), title: 'another collection', collectionId: collections[1].id, offline: true };
await writeFile(path.join(data, 'library', 'library.json'), JSON.stringify({ version: 1, collections, pins: [...pins, otherPin] }));
let app, page;
const errors = [];
const pinOrder = () => page.locator('.pin').evaluateAll(nodes => nodes.map(node => node.dataset.pinId));
const pinGeometry = () => page.locator('.pin').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.pinId, left: node.style.left, top: node.style.top, width: node.style.width, height: node.style.height })).sort((a, b) => a.id.localeCompare(b.id)));
const savedPinOrder = () => page.evaluate(id => window.papan.library().then(library => library.pins.filter(pin => pin.collectionId === id).map(pin => pin.id)), collections[0].id);
async function launch() {
  app = await electron.launch({ executablePath: process.env.PAPAN_EXECUTABLE, args: process.env.PAPAN_EXECUTABLE ? [] : [process.cwd()], env: { ...process.env, PAPAN_DATA_DIR: data, ELECTRON_RUN_AS_NODE: undefined } });
  page = await app.firstWindow();
  if (process.env.DISPLAY === ':97') {
    const id = await app.evaluate(({ BrowserWindow }) => '0x' + BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE().toString(16));
    assert.equal(spawnSync('xprop', ['-display', ':97', '-id', id, 'WM_CLASS']).status, 0, 'test window belongs to the isolated display');
  }
  page.on('pageerror', error => errors.push(error.message));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
  await expect(page.getByRole('tab')).toHaveCount(collections.length);
  await app.evaluate(({ shell }) => { globalThis.papanOpened = []; shell.openExternal = async url => { globalThis.papanOpened.push(url); }; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
try {
  await mkdir('artifacts', { recursive: true });
  await launch();
  await expect(page.locator('.pin')).toHaveCount(pins.length);
  await expect(page.locator('.toolbar-actions > button:visible')).toHaveCount(6);
  assert.ok(await page.evaluate(() => {
    const logo = document.querySelector('.wordmark').getBoundingClientRect(), mode = document.querySelector('#storage-mode').getBoundingClientRect();
    return mode.top >= logo.bottom && Math.abs(mode.left - logo.left) < 2;
  }));
  await page.getByRole('tab', { name: 'saved offline', exact: true }).click();
  await expect(page.locator('#storage-mode')).toHaveText('offline');
  await page.getByRole('tab', { name: 'inspiration', exact: true }).click();
  await expect(page.locator('#storage-mode')).toHaveText('online');

  // Exercise native drag events with pointer movement, rather than dispatching a synthetic drop.
  const beforeDrag = await pinGeometry();
  const movingBox = await page.locator('.pin').first().boundingBox(), hoverBox = await page.locator('.pin').nth(2).boundingBox();
  await page.mouse.move(movingBox.x + 25, movingBox.y + 25);
  await page.mouse.down();
  await page.mouse.move(movingBox.x + 55, movingBox.y + 55, { steps: 8 });
  await page.mouse.move(hoverBox.x + 8, hoverBox.y + 40);
  await page.mouse.move(hoverBox.x + 8, hoverBox.y + 40);
  await expect(page.locator('.pin.dragging')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('.pin.dragging > .tile-main')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#drop-marker')).toBeHidden();
  await expect.poll(pinGeometry).not.toEqual(beforeDrag);
  const hoverGeometry = await pinGeometry();
  assert.deepEqual(await savedPinOrder(), pins.map(pin => pin.id), 'hovering does not save the preview');
  const placeholder = await page.locator('.pin.dragging').boundingBox();
  assert.ok(Math.abs(placeholder.width / placeholder.height - collectionRatio) < .01, 'outline keeps the collection-wide frame proportions, independent of its cover');
  await page.waitForTimeout(450);
  assert.deepEqual(await pinGeometry(), hoverGeometry, 'stationary hover does not shuffle the board');
  await page.screenshot({ path: 'artifacts/pin-drag-preview.png' });
  await page.mouse.up();
  const expected = [pins[1], pins[0], ...pins.slice(2)].map(pin => pin.id);
  await expect.poll(pinOrder).toEqual(expected);
  await expect.poll(pinGeometry).toEqual(hoverGeometry);
  assert.deepEqual(await savedPinOrder(), expected);
  await page.locator('.pin').nth(0).dragTo(page.locator('.pin').nth(1), { targetPosition: { x: 8, y: 40 } });
  await expect.poll(pinOrder).toEqual(expected);
  const targetBox = await page.locator('.pin').nth(1).boundingBox();
  await page.locator('.pin').nth(0).dragTo(page.locator('.pin').nth(1), { targetPosition: { x: targetBox.width - 8, y: 40 } });
  await expect.poll(pinOrder).toEqual(pins.map(pin => pin.id));
  await page.locator('.pin').nth(0).dragTo(page.locator('.pin').nth(2), { targetPosition: { x: 8, y: 40 } });
  await expect.poll(pinOrder).toEqual(expected);
  await page.locator(`.pin[data-pin-id="${pins[2].id}"] .tile-main`).press('Alt+ArrowLeft');
  expected.splice(1, 0, expected.splice(2, 1)[0]);
  await expect.poll(savedPinOrder).toEqual(expected);
  await expect.poll(pinOrder).toEqual(expected);

  await page.getByRole('tab', { name: 'ideas', exact: true }).dragTo(page.getByRole('tab', { name: 'inspiration', exact: true }), { targetPosition: { x: 5, y: 20 } });
  await expect.poll(() => page.getByRole('tab').allTextContents()).toEqual(['ideas', 'inspiration', 'saved offline']);
  await page.getByRole('tab', { name: 'ideas', exact: true }).press('Alt+ArrowRight');
  await expect.poll(() => page.getByRole('tab').allTextContents()).toEqual(['inspiration', 'ideas', 'saved offline']);
  const lastTab = await page.getByRole('tab', { name: 'saved offline', exact: true }).boundingBox();
  await page.getByRole('tab', { name: 'ideas', exact: true }).dragTo(page.getByRole('tab', { name: 'saved offline', exact: true }), { targetPosition: { x: lastTab.width - 5, y: 20 } });
  await expect.poll(() => page.getByRole('tab').allTextContents()).toEqual(['inspiration', 'saved offline', 'ideas']);
  await page.getByRole('tab', { name: 'ideas', exact: true }).press('Alt+ArrowLeft');
  await expect.poll(() => page.getByRole('tab').allTextContents()).toEqual(['inspiration', 'ideas', 'saved offline']);
  assert.deepEqual(await app.evaluate(() => globalThis.papanOpened), [], 'dragging does not open a source link');

  // Cancelling an in-progress drag must not persist an order or activate a pin.
  await page.evaluate(() => { window.scrollTo(0, 0); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const beforeCancel = await pinGeometry();
  const source = await page.locator('.pin').first().boundingBox(), cancelTarget = await page.locator('.pin').nth(2).boundingBox();
  await page.mouse.move(source.x + 25, source.y + 25);
  await page.mouse.down();
  await page.mouse.move(source.x + 55, source.y + 55, { steps: 8 });
  await page.mouse.move(cancelTarget.x + 8, cancelTarget.y + 40);
  await page.mouse.move(cancelTarget.x + 8, cancelTarget.y + 40);
  await expect(page.locator('body')).toHaveClass(/is-dragging/);
  await expect.poll(pinGeometry).not.toEqual(beforeCancel);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('body')).not.toHaveClass(/is-dragging/);
  await expect.poll(pinGeometry).toEqual(beforeCancel);
  assert.deepEqual(await savedPinOrder(), expected);
  await page.locator('.tile-main').first().click();
  await expect(page.locator('#viewer')).toBeVisible();
  assert.deepEqual(await app.evaluate(() => globalThis.papanOpened), []);
  await page.getByRole('button', { name: 'open original ↗', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.papanOpened), [pins[1].sourceUrl]);
  const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText());
  await page.getByRole('button', { name: 'copy link', exact: true }).click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), pins[1].sourceUrl);
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), clipboardBefore);
  assert.deepEqual(await app.evaluate(() => globalThis.papanOpened), [pins[1].sourceUrl], 'copying does not open the browser');
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click();

  const beforeInvalid = await page.evaluate(() => window.papan.library());
  for (const input of [null, { kind: 'wrong', id: pins[0].id, beforeId: null }, { kind: 'pin', id: pins[0].id, beforeId: 'missing' }, { kind: 'pin', id: 'missing', beforeId: null }, { kind: 'pin', id: pins[0].id, beforeId: otherPin.id }]) {
    const rejected = await page.evaluate(async input => { try { await window.papan.reorder(input); return false; } catch { return true; } }, input);
    assert.equal(rejected, true, 'invalid or cross-collection moves are rejected');
  }
  assert.deepEqual(await page.evaluate(() => window.papan.library()), beforeInvalid);

  await page.getByRole('button', { name: 'Search collection', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search collection', exact: true });
  await expect(search).toBeFocused();
  await search.fill('pin 2');
  await expect(page.locator('.pin')).toHaveCount(1);
  await search.press('Escape');
  await expect(page.locator('#toggle-search')).toHaveClass(/has-filter/);
  await page.getByRole('button', { name: 'Search collection', exact: true }).click();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.locator('.pin')).toHaveCount(pins.length);
  await search.press('Escape');

  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const originalBox = await page.locator('.pin').first().boundingBox();
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'save settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'create collection', exact: true })).toHaveCount(0);
  await page.getByRole('slider', { name: 'preview size', exact: true }).press('Home');
  await expect.poll(async () => (await page.locator('.pin').first().boundingBox()).width).toBeLessThan(originalBox.width / 2);
  assert.equal((await page.evaluate(() => window.papan.library())).collections[0].settings.density, 3, 'preview does not save early');
  await page.getByLabel('media fit', { exact: true }).selectOption('cover');
  await expect(page.locator('#grid')).toHaveAttribute('data-fit', 'cover');
  await expect.poll(() => page.locator('.pin').evaluateAll(nodes => nodes.every(node => Math.abs(node.offsetWidth - node.offsetHeight) <= 1))).toBe(true);
  await page.screenshot({ path: 'artifacts/settings-live-preview.png' });
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.locator('#grid')).toHaveAttribute('data-fit', 'cover');
  assert.equal((await page.evaluate(() => window.papan.library())).collections[0].settings.density, 20);

  // Invalid settings remain editable; Enter and Escape both save valid edits.
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await page.getByLabel('name', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  assert.equal(await page.locator('#collection-name').evaluate(input => input.validity.valueMissing), true);
  await expect(page.getByRole('button', { name: 'discard changes', exact: true })).toBeVisible();
  await page.getByLabel('name', { exact: true }).fill('renamed inspiration');
  await page.getByLabel('name', { exact: true }).press('Enter');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.getByRole('tab', { name: 'renamed inspiration', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await page.getByLabel('name', { exact: true }).fill('inspiration');
  await page.getByLabel('media fit', { exact: true }).selectOption('contain');
  await page.getByRole('slider', { name: 'preview size', exact: true }).press('ArrowRight');
  await page.getByRole('slider', { name: 'preview size', exact: true }).press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();

  const collectionCount = (await page.evaluate(() => window.papan.library())).collections.length;
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await expect(page.locator('.collection-tab[aria-selected="true"]')).toHaveText('new tab');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.locator('#start-collecting')).toBeVisible(); await expect(page.locator('#open-empty-collection')).toBeVisible();
  assert.equal((await page.evaluate(() => window.papan.library())).collections.length, collectionCount);
  await page.keyboard.press('Control+w'); await expect(page.locator('.collection-tab')).toHaveCount(collectionCount);
  await app.close(); app = null;
  await launch();
  await expect.poll(pinOrder).toEqual(expected);
  await expect.poll(() => page.getByRole('tab').allTextContents()).toEqual(['inspiration', 'ideas', 'saved offline']);
  assert.equal((await page.evaluate(() => window.papan.library())).collections[0].settings.density, 19.5);
  assert.equal((await page.evaluate(() => window.papan.library())).collections[0].settings.fit, 'contain');
  await page.screenshot({ path: 'artifacts/toolbar-and-dragging.png' });
  for (const width of [1200, 781, 560]) {
    await page.setViewportSize({ width, height: 740 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.toolbar-actions button')].every(button => { const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })));
    await expect(page.locator('#storage-mode')).toBeVisible();
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/interaction-check.json', JSON.stringify({ date: new Date().toISOString(), status: 'passed', packaged: Boolean(process.env.PAPAN_EXECUTABLE) }, null, 2));
  console.log('Interactions passed: button toolbar, status position, native pin/tab dragging, keyboard reordering, validation, search, live layout preview, settings saved on close/Escape/Enter, blank tab creation/closing, and persisted order/settings after restart.');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: 'artifacts/interaction-failure.png' });
  throw error;
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
