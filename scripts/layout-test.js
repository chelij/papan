import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { startFixture } from '../test/fixture.js';
import { spawnSync } from 'node:child_process';

const data = await mkdtemp(path.join(os.tmpdir(), 'papan-layout-'));
const fixture = await startFixture();
const ratios = [[9, 16], [4, 3], [16, 9], [1, 1], [3, 2], [2, 3], [3, 1], [5, 4], [9, 16], [21, 9]];
const collectionRatio = ratios.reduce((sum, [w, h]) => sum + w / h, 0) / ratios.length;
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath: process.env.PAPAN_EXECUTABLE, args: process.env.PAPAN_EXECUTABLE ? [] : [process.cwd()], env: { ...process.env, PAPAN_DATA_DIR: data, ELECTRON_RUN_AS_NODE: undefined } });
  page = await app.firstWindow();
  if (process.env.DISPLAY === ':97') {
    const id = await app.evaluate(({ BrowserWindow }) => '0x' + BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE().toString(16));
    assert.equal(spawnSync('xprop', ['-display', ':97', '-id', id, 'WM_CLASS']).status, 0, 'test window belongs to the isolated display');
  }
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.papan));
}
async function geometry(width) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const result = await page.evaluate(() => ({
    width: document.querySelector('#grid').clientWidth,
    cards: [...document.querySelectorAll('.pin')].map(card => ({
      left: parseFloat(card.style.left), top: parseFloat(card.style.top),
      width: parseFloat(card.style.width), height: parseFloat(card.style.height),
      fit: card.querySelector('img') ? getComputedStyle(card.querySelector('img')).objectFit : 'cover',
    })),
  }));
  assert.equal(result.cards.length, ratios.length);
  const rows = [];
  for (const [index, card] of result.cards.entries()) {
    assert.ok(card.width > 0 && card.height > 0);
    assert.ok(card.left >= 12 - 0.1 && card.left + card.width <= result.width - 12 + 0.1, 'tile stays inside the row');
    assert.ok(Math.abs(card.width - result.cards[0].width) < 0.1, 'all rows use the same column width, including the last row');
    assert.ok(Math.abs(card.width / card.height - collectionRatio) < 0.01, 'every pin uses the collection-wide mean media ratio');
    assert.equal(card.fit, 'cover');
    const previous = result.cards[index - 1];
    if (!previous || Math.abs(card.top - previous.top) > 0.1) {
      if (previous) assert.ok(card.top >= Math.max(...rows.at(-1).map(item => item.top + item.height)) + 7.9, 'new rows start below the tallest item in the previous row');
      rows.push([]);
    } else {
      assert.ok(card.left >= previous.left + previous.width + 7.9, 'tiles retain insertion order without overlap');
      assert.ok(Math.abs(card.height - previous.height) < 0.1, 'items in a row share a height');
    }
    rows.at(-1).push(card);
  }
  for (const row of rows) {
    for (const [column, card] of row.entries()) assert.ok(Math.abs(card.left - rows[0][column].left) < 0.1, 'columns align vertically across rows');
  }
  for (const row of rows.slice(0, -1)) {
    const last = row.at(-1);
    assert.ok(Math.abs(last.left + last.width - (result.width - 12)) < 0.1, 'completed rows fit the available width');
  }
  return { rows: rows.length, averageArea: result.cards.reduce((sum, card) => sum + card.width * card.height, 0) / result.cards.length };
}
try {
  await mkdir('artifacts', { recursive: true });
  await launch();
  for (const [index, [w, h]] of ratios.entries()) {
    await page.evaluate(async url => {
      const found = await window.papan.inspect({ requestId: crypto.randomUUID(), url });
      await window.papan.save({ requestId: crypto.randomUUID(), inspectionId: found.id, selectedIds: found.items.map(item => item.id), coverId: found.items[0].id });
    }, `${fixture.url}/ratio-${w}-${h}.svg?sample=${index}`);
  }
  await page.reload();
  await expect(page.locator('.pin')).toHaveCount(ratios.length);
  const wide = await geometry(1280);
  await page.screenshot({ path: 'artifacts/adaptive-layout.png', fullPage: true });
  const narrow = await geometry(640);
  assert.ok(narrow.rows > wide.rows, 'narrow windows reflow into more rows');
  await page.getByRole('button', { name: 'Search collection', exact: true }).click();
  await page.locator('#search').fill('ratio-16-9');
  await expect(page.locator('.pin')).toHaveCount(1);
  await expect.poll(() => page.locator('.pin').evaluate(card => parseFloat(card.style.width) / parseFloat(card.style.height))).toBeCloseTo(collectionRatio, 2);
  await page.locator('#search').fill('');
  await page.locator('#search').press('Escape');
  await expect(page.locator('.pin')).toHaveCount(ratios.length);
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  const size = page.getByRole('slider', { name: 'preview size', exact: true });
  const seconds = page.getByRole('slider', { name: 'slideshow interval', exact: true });
  for (const slider of [size, seconds]) {
    await expect(slider).toHaveAttribute('min', '1');
    await expect(slider).toHaveAttribute('max', '10');
  }
  await expect(size).toHaveValue('8');
  await size.press('End');
  await expect(page.locator('#size-value')).toHaveText('10');
  await seconds.press('End');
  await expect(page.locator('#slideshow-value')).toHaveText('10 s');
  await seconds.press('Home');
  await expect(seconds).toHaveAttribute('aria-valuetext', '1 second');
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  const spacious = await geometry(1280);
  // Use the native desktop viewport for pointer coordinates after responsive emulation.
  const devtools = await page.context().newCDPSession(page);
  await devtools.send('Emulation.clearDeviceMetricsOverride');
  await devtools.detach();
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await expect(size).toHaveValue('10');
  const track = await size.boundingBox();
  await page.mouse.move(track.x + track.width - 6, track.y + track.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + 2, track.y + track.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(size).toHaveValue('1');
  await expect(page.locator('#size-value')).toHaveText('1');
  await page.screenshot({ path: 'artifacts/sliders.png' });
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  const compact = await geometry(1280);
  assert.ok(spacious.averageArea > compact.averageArea * 2, 'higher preview size makes larger tiles');
  await app.close(); app = null;
  await launch();
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'preview size', exact: true })).toHaveValue('1');
  await expect(page.getByRole('slider', { name: 'slideshow interval', exact: true })).toHaveValue('1');
  await page.getByRole('slider', { name: 'preview size', exact: true }).press('End');
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  assert.equal((await page.evaluate(() => window.papan.library())).collections[0].settings.density, 1);
  const savedSettings = (await page.evaluate(() => window.papan.library())).collections[0].settings;
  const canvas = await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvas.x + 30, canvas.y + 30);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 120);
  await expect.poll(() => page.evaluate(() => window.papan.library().then(data => data.collections[0].settings.density))).toBe(2);
  await page.mouse.wheel(0, -120);
  await expect.poll(() => page.evaluate(() => window.papan.library().then(data => data.collections[0].settings.density))).toBe(1);
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  assert.deepEqual((await page.evaluate(() => window.papan.library())).collections[0].settings, savedSettings, 'wheel changes only preview size and clamps at the largest size');
  const zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  assert.equal(zoom, 1, 'Ctrl+wheel changes previews without zooming the window');
  for (const density of [0, 11, 1.5]) {
    assert.equal(await page.evaluate(async density => {
      const data = await window.papan.library();
      try { await window.papan.setPreviewSize({ id: data.collections[0].id, density }); return false; } catch { return true; }
    }, density), true, 'preview size is validated in the main process');
  }

  // Seed only the temporary test library to exercise legacy/mixed album metadata.
  const library = await page.evaluate(() => window.papan.library());
  await app.close(); app = null;
  library.collections[0].settings = { ...library.collections[0].settings, density: 5, slideshowSeconds: 1 };
  const albums = [
    { title: 'common portrait shape', sizes: [[9, 16], [3, 4], [6, 8], [3, 4]] },
    { title: 'different order and cover', sizes: [[3, 4], [6, 8], [9, 16], [3, 4]], caption: true },
    { title: 'balanced wide and tall', sizes: [[9, 16], [16, 9]] },
    { title: 'same shape, different resolution', sizes: [[4, 3], [40, 30]] },
    { title: 'missing image dimensions', sizes: [[9, 16], [16, 9]], unknown: true },
    { title: 'unavailable slide', sizes: [[3, 4], [0, 0]], unknown: true },
  ];
  library.pins = albums.map(album => {
    const items = album.sizes.map(([w, h]) => ({ id: randomUUID(), kind: 'image', url: `${fixture.url}/${w ? `ratio-${w}-${h}.svg` : 'missing'}`,
      ...(album.unknown ? {} : { width: w * 120, height: h * 120 }) }));
    if (album.caption) items.push({ id: randomUUID(), kind: 'text', text: 'The caption does not affect the frame.' });
    return { id: randomUUID(), collectionId: library.collections[0].id, title: album.title, sourceUrl: `${fixture.url}/album`, coverId: items[0].id, items };
  });
  await writeFile(path.join(data, 'library', 'library.json'), JSON.stringify(library));
  await launch();
  await expect(page.locator('.pin')).toHaveCount(albums.length);
  const albumFrames = () => page.locator('.pin').evaluateAll(cards => cards.map(card => parseFloat(card.style.width) / parseFloat(card.style.height)));
  const knownRatios = albums.flatMap(album => album.sizes.filter(([w, h]) => w && h).map(([w, h]) => w / h));
  const albumCollectionRatio = knownRatios.reduce((sum, ratio) => sum + ratio, 0) / knownRatios.length;
  await expect.poll(async () => (await albumFrames()).every(ratio => Math.abs(ratio - albumCollectionRatio) < .001)).toBe(true);
  for (const [index, album] of albums.entries()) {
    const card = page.locator('.pin').nth(index);
    await expect(card.locator('img')).toHaveCSS('object-fit', 'cover');
  }
  const frames = await albumFrames();
  const firstSlide = await page.locator('.pin img').first().getAttribute('src');
  await expect.poll(() => page.locator('.pin img').first().getAttribute('src')).not.toBe(firstSlide);
  assert.deepEqual(await albumFrames(), frames, 'slideshow changes do not resize album frames');
  await page.screenshot({ path: 'artifacts/album-frames.png' });
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await page.getByLabel('media fit', { exact: true }).selectOption('cover');
  await expect.poll(albumFrames).toEqual(albums.map(() => 1));
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect.poll(albumFrames).toEqual(albums.map(() => 1));
  assert.deepEqual(errors, []);
  await writeFile('artifacts/layout-check.json', JSON.stringify({ date: new Date().toISOString(), status: 'passed', wide, narrow, spacious, compact, sliders: [1, 10], collectionRatio, albumCollectionRatio, albums: albums.map(({ title }) => title) }, null, 2));
  console.log('Collection layout passed: aligned rows, mean media ratio, stable filtering/slideshows, responsive columns, 1–10 sliders, settings saved on close, missing dimensions, and persisted square frames.');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: 'artifacts/layout-failure.png', fullPage: true });
  throw error;
} finally {
  if (app) await app.close();
  await fixture.close();
  await rm(data, { recursive: true, force: true });
}
