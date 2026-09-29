import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
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
// Drag an album whose common shape differs from its starting cover.
pins[0].items.push(...Array.from({ length: 3 }, () => ({ ...pins[1].items[0], id: randomUUID() })));
const otherPin = { ...pins[0], id: randomUUID(), title: 'another collection', collectionId: collections[1].id, offline: true };
await writeFile(path.join(data, 'library', 'library.json'), JSON.stringify({ version: 1, collections, pins: [...pins, otherPin] }));
let app, page;
const errors = [];
const pinOrder = () => page.locator('.pin').evaluateAll(nodes => nodes.map(node => node.dataset.pinId));
const pinGeometry = () => page.locator('.pin').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.pinId, left: node.style.left, top: node.style.top, width: node.style.width, height: node.style.height })).sort((a, b) => a.id.localeCompare(b.id)));
const savedPinOrder = () => page.evaluate(id => window.papan.library().then(library => library.pins.filter(pin => pin.collectionId === id).map(pin => pin.id)), collections[0].id);
async function launch() {
  app = await electron.launch({ executablePath: process.env.PAPAN_EXECUTABLE, args: process.env.PAPAN_EXECUTABLE ? [] : [process.cwd()], env: { ...process.env, PAPAN_DATA_DIR: data, ELECTRON_RUN_AS_NODE: '' } });
  page = await app.firstWindow();
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
  await expect(page.locator('.toolbar-actions > button')).toHaveCount(6);
  assert.ok(await page.evaluate(() => {
    const logo = document.querySelector('.wordmark').getBoundingClientRect(), mode = document.querySelector('#storage-mode').getBoundingClientRect();
    return mode.top >= logo.bottom && Math.abs(mode.left - logo.left) < 2;
  }));
  await page.getByRole('tab', { name: 'saved offline', exact: true }).click();
  await expect(page.locator('#storage-mode')).toHaveText('originals saved');
  await page.getByRole('tab', { name: 'inspiration', exact: true }).click();
  await expect(page.locator('#storage-mode')).toHaveText('previews cached');

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
  assert.ok(Math.abs(placeholder.width / placeholder.height - 4 / 3) < .01, 'outline keeps the shared album proportions, independent of its cover');
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
  const beforeCancel = await pinGeometry();
  const source = await page.locator('.pin').first().boundingBox(), cancelTarget = await page.locator('.pin').nth(4).boundingBox();
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
  assert.deepEqual(await app.evaluate(() => globalThis.papanOpened), [pins[1].sourceUrl]);

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

  const originalBox = await page.locator('.pin').first().boundingBox();
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await page.getByRole('slider', { name: 'layout density', exact: true }).press('End');
  await expect.poll(async () => (await page.locator('.pin').first().boundingBox()).width).toBeLessThan(originalBox.width / 2);
  assert.equal((await page.evaluate(() => window.papan.library())).collections[0].settings.density, 3, 'preview does not save early');
  await page.getByLabel('media fit', { exact: true }).selectOption('cover');
  await expect(page.locator('#grid')).toHaveAttribute('data-fit', 'cover');
  await expect.poll(() => page.locator('.pin').evaluateAll(nodes => nodes.every(node => Math.abs(node.offsetWidth - node.offsetHeight) <= 1))).toBe(true);
  await page.screenshot({ path: 'artifacts/settings-live-preview.png' });
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#grid')).toHaveAttribute('data-fit', 'contain');
  await expect.poll(async () => Math.abs((await page.locator('.pin').first().boundingBox()).width - originalBox.width)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await page.getByRole('slider', { name: 'layout density', exact: true }).press('End');
  await page.getByRole('button', { name: 'save settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await app.close(); app = null;
  await launch();
  await expect.poll(pinOrder).toEqual(expected);
  await expect.poll(() => page.getByRole('tab').allTextContents()).toEqual(['inspiration', 'ideas', 'saved offline']);
  assert.equal((await page.evaluate(() => window.papan.library())).collections[0].settings.density, 10);
  await page.screenshot({ path: 'artifacts/toolbar-and-dragging.png' });
  for (const width of [1200, 781, 560]) {
    await page.setViewportSize({ width, height: 740 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.toolbar-actions button')].every(button => { const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })));
    await expect(page.locator('#storage-mode')).toBeVisible();
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/interaction-check.json', JSON.stringify({ date: new Date().toISOString(), status: 'passed', packaged: Boolean(process.env.PAPAN_EXECUTABLE) }, null, 2));
  console.log('Interactions passed: button toolbar, status position, native pin/tab dragging, keyboard reordering, cancel/click behavior, validation, search, live layout preview/cancel, and persisted order/settings after restart.');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: 'artifacts/interaction-failure.png' });
  throw error;
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
