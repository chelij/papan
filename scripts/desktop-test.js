import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { startFixture } from '../test/fixture.js';

const root = process.cwd();
const data = await mkdtemp(path.join(os.tmpdir(), 'papan-desktop-'));
const fixture = await startFixture({ video: true });
await mkdir('artifacts', { recursive: true });
let app, page, fixtureClosed = false;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath: process.env.PAPAN_EXECUTABLE, args: process.env.PAPAN_EXECUTABLE ? [] : [root], env: { ...process.env, PAPAN_DATA_DIR: data, ELECTRON_RUN_AS_NODE: undefined }, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.papan));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function add(resource, { first = false, choose } = {}) {
  await page.getByRole('button', { name: first ? 'paste link to start collecting' : 'Add link', exact: true }).click();
  await page.getByLabel('a link from anywhere').fill(fixture.url + resource);
  await page.getByRole('button', { name: 'find media' }).click();
  await expect(page.locator('#inspection')).toBeVisible({ timeout: 15000 });
  if (choose) await choose();
  await page.getByRole('button', { name: 'add to collection' }).click();
  await expect(page.locator('#add-dialog')).not.toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => window.papan.downloads().then(tasks => tasks.every(task => task.state === 'completed'))), { timeout: 45000 }).toBe(true);
}
try {
  await launch();
  const tools = await page.evaluate(() => window.papan.tools());
  assert.ok(tools['gallery-dl'] && tools['yt-dlp'] && tools.Instaloader);
  await expect(page.locator('#toolbar')).toBeHidden();
  assert.equal(await page.locator('#start-collecting').innerText(), 'paste link to start collecting');
  await expect(page.getByRole('button', { name: 'open a collection', exact: true })).toBeVisible();
  assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(0, 0, 0)');
  await page.screenshot({ path: 'artifacts/empty.png' });
  await add('/album', { first: true, choose: async () => {
    await page.getByLabel('Select image 3', { exact: true }).uncheck();
    await page.getByLabel('Use item 2 as cover', { exact: true }).check();
    await page.screenshot({ path: 'artifacts/media-picker.png' });
  } });
  await expect(page.locator('#toolbar')).toBeVisible();
  await expect(page.locator('.pin')).toHaveCount(1);
  const saved = await page.evaluate(() => window.papan.library());
  assert.equal(saved.pins[0].items.length, 2);
  assert.equal(saved.collections.length, 1);
  assert.equal(saved.pins[0].offline, false);
  assert.equal(saved.collections[0].settings.density, 3);
  await page.waitForFunction(() => {
    const img = document.querySelector('.tile-media img'), card = document.querySelector('.pin');
    return img?.naturalWidth === 1280 && Math.abs(card.clientWidth / card.clientHeight - 1) < 0.02 && getComputedStyle(img).objectFit === 'cover';
  });
  const firstSource = await page.locator('.tile-media img').getAttribute('src');
  await page.waitForFunction(src => document.querySelector('.tile-media img')?.src !== src, firstSource, { timeout: 8000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('.tile-media img'), card = document.querySelector('.pin');
    return img?.naturalWidth === 600 && getComputedStyle(img).objectFit === 'cover' && Math.abs(card.clientWidth / card.clientHeight - 1) < 0.02;
  });
  await app.evaluate(({ shell }) => { globalThis.papanOpened = []; shell.openExternal = async url => { globalThis.papanOpened.push(url); }; });
  await page.locator('.tile-main').click();
  await expect(page.locator('#viewer')).toBeVisible();
  assert.deepEqual(await app.evaluate(() => globalThis.papanOpened), []);
  await page.getByRole('button', { name: 'open original ↗', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.papanOpened), [`${fixture.url}/album`]);
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click();

  await add('/mixed');
  const mixed = page.locator('.pin').nth(1);
  await page.waitForFunction(() => {
    const v = document.querySelectorAll('.pin')[1]?.querySelector('video');
    return v && v.muted && !v.paused && !v.loop && v.duration > 11.9 && v.videoWidth === 720 && v.currentTime > 8.2;
  }, null, { timeout: 20000 });
  await expect.poll(() => mixed.evaluate(card => card.clientWidth / card.clientHeight)).toBeCloseTo(Math.sqrt((4 / 3) * .5), 2);
  await expect(mixed.locator('img')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => mixed.evaluate(card => card.clientWidth / card.clientHeight)).toBeCloseTo(Math.sqrt((4 / 3) * .5), 2);

  await page.getByLabel('New tab', { exact: true }).click();
  await expect(page.locator('.collection-tab[aria-selected="true"]')).toHaveText('new tab');
  await add('/video');
  await page.getByLabel('Collection settings', { exact: true }).click();
  await page.getByLabel('name', { exact: true }).fill('offline references');
  await page.getByRole('tab', { name: 'Storage', exact: true }).click();
  await page.getByLabel('media storage').selectOption('offline');
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.papan.downloads().then(tasks => tasks.every(task => !['queued', 'running'].includes(task.state)))), { timeout: 45000 }).toBe(true);
  const video = page.locator('.tile-media video');
  await expect(video).toBeVisible();
  await page.waitForFunction(() => { const v = document.querySelector('.tile-media video'); return v && v.muted && !v.paused && v.currentTime > 0.15; }, null, { timeout: 15000 });
  await add('/article');
  await add('/album');
  await expect(page.locator('.pin')).toHaveCount(3);
  assert.deepEqual(await page.locator('.tile-title').allTextContents(), ['A little motion', 'A place for curiosity', 'Collected colors']);
  await page.waitForFunction(() => [...document.querySelectorAll('.pin')].every(pin => pin.style.width && pin.style.height));
  const boxes = await page.locator('.pin').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
  assert.ok(boxes.slice(1).every((box, index) => box.y > boxes[index].y || box.y === boxes[index].y && box.x > boxes[index].x), 'pins keep reading order as rows wrap');
  await page.waitForFunction(() => {
    const card = document.querySelector('.pin'), v = card?.querySelector('video');
    return v && v.videoWidth === 720 && v.videoHeight === 540 && v.duration > 11.9 && v.loop && Math.abs(card.clientWidth / card.clientHeight - 4 / 3) < 0.02;
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 900));
  await page.waitForFunction(() => [...document.querySelectorAll('.pin')].every(card => card.offsetLeft + card.offsetWidth <= document.querySelector('#grid').clientWidth));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 820));
  await page.screenshot({ path: 'artifacts/collection.png', fullPage: true });

  await page.getByLabel('Collection settings', { exact: true }).click();
  await page.getByRole('slider', { name: 'slideshow interval', exact: true }).press('Home');
  const previewSlide = await page.locator('.pin').nth(2).locator('img').getAttribute('src');
  await page.waitForFunction(src => document.querySelectorAll('.pin')[2]?.querySelector('img')?.getAttribute('src') !== src, previewSlide, { timeout: 3000 });
  assert.equal((await page.evaluate(() => window.papan.library())).collections.find(c => c.name === 'offline references').settings.slideshowSeconds, 4);
  await page.getByLabel('autoplay & slideshows').uncheck();
  await page.waitForFunction(() => document.querySelector('.tile-media video')?.paused === true);
  const previewTime = await page.locator('.tile-media video').evaluate(video => video.currentTime);
  await page.getByLabel('autoplay & slideshows').check();
  await page.waitForFunction(time => { const video = document.querySelector('.tile-media video'); return video && !video.paused && video.currentTime !== time; }, previewTime);
  await page.getByLabel('autoplay & slideshows').uncheck();
  await page.getByRole('slider', { name: 'preview size', exact: true }).press('End');
  for (let step = 0; step < 3; step++) await page.getByRole('slider', { name: 'preview size', exact: true }).press('ArrowLeft');
  await page.screenshot({ path: 'artifacts/settings.png' });
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  assert.equal((await page.evaluate(() => window.papan.library())).collections.find(c => c.name === 'offline references').settings.density, 4);
  await page.waitForFunction(() => document.querySelector('.tile-media video')?.paused === true);
  const slide = await page.locator('.pin').nth(2).locator('img').getAttribute('src');
  await page.waitForTimeout(2400);
  assert.equal(await page.locator('.pin').nth(2).locator('img').getAttribute('src'), slide);
  const all = await page.evaluate(() => window.papan.library());
  const offlineId = all.collections.find(c => c.name === 'offline references').id;
  assert.equal(all.collections.find(c => c.id === offlineId).settings.motion, false);
  assert.ok(all.pins.filter(p => p.collectionId === offlineId).every(p => p.offline));

  // Converting an existing online collection materializes its original media.
  await page.getByRole('tab', { name: saved.collections[0].name, exact: true }).click();
  await page.getByLabel('Collection settings', { exact: true }).click();
  await page.getByRole('tab', { name: 'Storage', exact: true }).click();
  await page.getByLabel('media storage').selectOption('offline');
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.papan.library().then(data => data.pins[0].offline)), { timeout: 45000 }).toBe(true);

  await app.close(); app = null;
  await fixture.close(); fixtureClosed = true;
  await launch();
  await page.getByRole('tab', { name: 'offline references', exact: true }).click();
  await expect(page.locator('.pin')).toHaveCount(3);
  await page.locator('.tile-main').nth(2).click();
  await expect(page.locator('#viewer')).toBeVisible();
  await page.waitForFunction(() => document.querySelector('#viewer-media img')?.naturalWidth > 0);
  await page.getByLabel('Next item').click();
  await page.waitForFunction(() => document.querySelector('#viewer-media img')?.naturalWidth > 0);
  await page.getByLabel('Close viewer').click();
  await page.locator('.tile-main').nth(0).click();
  await page.waitForFunction(() => { const v = document.querySelector('#viewer-media video'); return v && v.readyState >= 2 && v.muted && v.duration > 1; });
  await page.getByLabel('Close viewer').click();
  await page.locator('.tile-main').nth(1).click();
  await expect(page.locator('.article-body')).toContainText('A quiet place');
  await page.getByLabel('Close viewer').click();

  await page.getByRole('button', { name: 'Search collection', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search collection', exact: true }).fill('curiosity');
  await expect(page.locator('.pin')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search collection', exact: true }).fill('');
  await page.getByRole('searchbox', { name: 'Search collection', exact: true }).press('Escape');
  await page.locator('.pin-detail').nth(1).click();
  await page.getByRole('button', { name: 'remove pin', exact: true }).click();
  await page.getByRole('button', { name: 'remove', exact: true }).click();
  await expect(page.locator('.pin')).toHaveCount(2);
  await app.close(); app = null;

  // Seed only this test library to verify multiple pages without 100 downloads.
  const file = path.join(data, 'library', 'library.json');
  const bulk = JSON.parse(await readFile(file, 'utf8'));
  const model = bulk.pins.find(p => p.collectionId === offlineId && p.items[0].kind === 'image');
  for (let index = 0; index < 102; index++) bulk.pins.push({ ...model, id: randomUUID(), title: `pagination ${index}` });
  await writeFile(file, JSON.stringify(bulk));
  await launch();
  await page.getByRole('tab', { name: 'offline references', exact: true }).click();
  await expect(page.locator('.pin')).toHaveCount(48);
  await page.locator('.pin').last().scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('.pin').count()).toBeGreaterThanOrEqual(96);
  await page.locator('.pin').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.pin')).toHaveCount(104);
  assert.deepEqual(errors, []);
  console.log('Desktop checks passed: adaptive rows, stable album frames with cropped slides, full video playback past eight seconds, album advance after video ends, preview size and slideshow sliders, offline restart/viewer, and continuous scrolling.');
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: 'artifacts/desktop-failure.png' }); console.error(await page.locator('body').innerText()); }
  throw error;
} finally {
  if (app) await app.close();
  if (!fixtureClosed) await fixture.close();
  await rm(data, { recursive: true, force: true });
}
