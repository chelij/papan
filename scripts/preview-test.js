import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { newCollection, pinDetails, pinPreviews } from '../src/library.js';
import { startFixture } from '../test/fixture.js';

// The real renderer and decoded video run without using the desktop display.
// The preload boundary is stubbed; persistence validation uses the production validators.
const fixture = await startFixture({ video: true, extraVideo: true });
const online = newCollection('previews', { slideshowSeconds: 1 }), offline = newCollection('offline', { mode: 'offline' });
const imageId = randomUUID(), videoId = randomUUID(), secondVideoId = randomUUID(), textId = randomUUID();
const pin = { id: randomUUID(), collectionId: online.id, title: 'Saved media previews', sourceUrl: `${fixture.url}/mixed`,
  engine: 'page', coverId: imageId, offline: false, tags: ['reference'], notes: 'Keep the complete media', items: [
    { id: imageId, kind: 'image', url: `${fixture.url}/red.svg`, previewWidth: 600, previewHeight: 1200 },
    { id: videoId, kind: 'video', url: `${fixture.url}/clip.mp4`, previewWidth: 1280, previewHeight: 960 },
    { id: secondVideoId, kind: 'video', url: `${fixture.url}/clip-short.mp4`, previewWidth: 1280, previewHeight: 960 },
    { id: textId, kind: 'text', text: 'The complete saved article remains available.' }
  ] };
const state = { collections: [online, offline], pins: [pin] }, calls = [], queued = [], errors = [], checks = [];
const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
let browser, page;
try {
  browser = await chromium.launch({ executablePath: process.env.PAPAN_CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--headless', '--ozone-platform=headless', '--enable-automation'], env });
  const cdp = await browser.newBrowserCDPSession();
  const { arguments: args } = await cdp.send('Browser.getBrowserCommandLine');
  assert.ok(args.some(arg => arg.startsWith('--headless')));
  assert.equal(args.filter(arg => arg.startsWith('--ozone-platform=')).at(-1), '--ozone-platform=headless');
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('readPreviewLibrary', () => structuredClone(state));
  await page.exposeFunction('savePreviewPin', input => {
    calls.push(structuredClone(input));
    const previews = pinPreviews(input.previews, pin.items, input.coverId);
    Object.assign(pin, pinDetails(input), { collectionId: input.collectionId, coverId: input.coverId, previews });
    return { pin: structuredClone(pin), collectionId: pin.collectionId };
  });
  await page.exposeFunction('queuePreviewPin', input => { queued.push(structuredClone(input)); return 'queued'; });
  await page.addInitScript(() => {
    window.papan = {
      library: () => window.readPreviewLibrary(), downloads: async () => [], onDownloads() {}, onProgress() {}, tools: async () => ({}),
      updatePin: async input => { if (window.failPreviewSave) throw new Error('Saved list unavailable'); return window.savePreviewPin(input); },
      enqueuePin: input => window.queuePreviewPin(input), openSource: async () => {}, cancel: async () => {}
    };
  });
  await page.goto(pathToFileURL(path.resolve('src/renderer/index.html')).href);
  await expect(page.locator('.pin')).toHaveCount(1);
  const openEditor = async () => {
    await page.locator('.tile-main').click();
    await page.locator('#edit-pin').click();
    await expect(page.locator('#pin-editor')).toBeVisible();
  };
  const closeEditor = async () => { await page.mouse.click(40, 110); await expect(page.locator('#pin-editor')).toBeHidden(); };
  const start = page.locator('#clip-start'), end = page.locator('#clip-end'), player = page.locator('#clip-player');
  const editVideo = number => page.getByRole('button', { name: `Edit video ${number} preview`, exact: true }).click();
  const currentRange = () => page.locator('.preview-item.editing').evaluate(row => ({ itemId: row.dataset.itemId, ...row._preview }));
  async function dragHandle(input, seconds) {
    await page.locator('#clip-range').scrollIntoViewIfNeeded();
    const bounds = await page.locator('#clip-range').boundingBox();
    const { value, max } = await input.evaluate(input => ({ value: input.valueAsNumber, max: Number(input.max) }));
    const x = time => bounds.x + 9 + (bounds.width - 18) * time / max, y = bounds.y + bounds.height / 2;
    await page.mouse.move(x(value), y); await page.mouse.down();
    await page.mouse.move(x(seconds), y, { steps: 12 }); await page.mouse.up();
  }
  async function checkFrames(range) {
    await expect.poll(() => page.locator('#clip-start-frame').evaluate(video => video.readyState >= 2 && !video.seeking)).toBe(true);
    await expect.poll(() => page.locator('#clip-end-frame').evaluate(video => video.readyState >= 2 && !video.seeking)).toBe(true);
    await expect.poll(() => page.locator('#clip-start-frame').evaluate(video => video.currentTime)).toBeCloseTo(range.start, 2);
    await expect.poll(() => page.locator('#clip-end-frame').evaluate(video => video.currentTime)).toBeCloseTo((range.end ?? Number(await end.getAttribute('max'))) - .001, 2);
    assert.equal(await page.locator('#clip-start-frame').evaluate(video => video.paused), true);
    assert.equal(await page.locator('#clip-end-frame').evaluate(video => video.paused), true);
  }
  await openEditor();
  await expect(page.locator('#clip-editor')).toBeHidden();
  await expect(page.getByLabel('Show image 1 in preview', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Show video 2 in preview', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Show video 3 in preview', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Show text 4 in preview', { exact: true })).not.toBeChecked();
  await page.getByLabel('Show image 1 in preview', { exact: true }).uncheck();
  await page.getByLabel('Show video 3 in preview', { exact: true }).uncheck();
  await expect(page.getByLabel('Cover item 2', { exact: true })).toBeChecked();
  await editVideo(2);
  await expect(start).toBeEnabled();
  await expect(start).toHaveAttribute('max', '12');
  await expect(page.locator('#pin-editor input[type="number"]')).toHaveCount(0);
  await start.press('End');
  assert.ok((await currentRange()).start < Number(await end.inputValue()), 'start cannot cross end');
  await start.press('Home'); await end.press('Home');
  assert.equal((await currentRange()).start, 0);
  assert.ok((await currentRange()).end > 0, 'end cannot cross start');
  await end.press('End');
  await dragHandle(start, 2.125); await dragHandle(end, 3.375);
  let firstRange = await currentRange();
  assert.ok(Math.abs(firstRange.start - 2.125) < .04 && Math.abs(firstRange.end - 3.375) < .04, JSON.stringify(firstRange));
  const beforeArrow = firstRange.start;
  await start.press('ArrowRight');
  assert.ok(Math.abs((await currentRange()).start - beforeArrow - .1) < .002);
  await start.press('ArrowLeft');
  firstRange = await currentRange();
  const savedRange = [firstRange];
  await checkFrames(firstRange);
  assert.notDeepEqual(await page.locator('#clip-start-frame').screenshot(), await page.locator('#clip-end-frame').screenshot(), 'boundary previews show different decoded frames');
  await page.locator('#play-clip').click();
  await expect.poll(() => player.evaluate(video => !video.paused)).toBe(true);
  await expect.poll(() => player.evaluate(video => video.paused && video.currentTime >= 3.3 && video.currentTime < 3.8)).toBe(true);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/edit-pin-previews.png' });
  await page.locator('#save-pin-edit').click();
  await expect(page.locator('#pin-editor')).toBeHidden();
  assert.deepEqual(pin.previews, savedRange);
  assert.equal(pin.items.length, 4);
  assert.equal(pin.coverId, videoId);
  checks.push('two pointer-dragged handles; keyboard adjustment; handles cannot cross; decoded start/end frames; playable clip; selected media retained');

  await expect(page.locator('.tile-media video')).toBeVisible();
  assert.equal(await page.locator('.pin').evaluate(card => card._slides.length), 1);
  await page.locator('.tile-media video').evaluate(video => {
    window.previewLoops = 0; window.previewSamples = [];
    let previous = video.currentTime;
    video.addEventListener('timeupdate', () => {
      if (video.currentTime < previous - .5) window.previewLoops++;
      window.previewSamples.push(video.currentTime); previous = video.currentTime;
    });
  });
  await expect.poll(() => page.evaluate(() => window.previewLoops), { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  const samples = await page.evaluate(() => window.previewSamples);
  assert.ok(Math.min(...samples) >= firstRange.start - .01 && Math.max(...samples) < firstRange.end + .4, JSON.stringify(samples));
  await page.locator('.tile-main').click();
  await expect.poll(() => page.locator('#viewer video').evaluate(video => video.currentTime)).toBeLessThan(1.5);
  await expect(page.locator('#viewer-position')).toHaveText('2 / 4');
  await page.locator('#viewer-next').click(); await page.locator('#viewer-next').click();
  await expect(page.locator('#viewer-media')).toContainText('complete saved article');
  await page.mouse.click(40, 110);
  await page.reload();
  await expect(page.locator('.tile-media video')).toBeVisible();
  await openEditor(); await editVideo(2);
  assert.deepEqual(await currentRange(), firstRange);
  await start.press('ArrowRight'); await closeEditor();
  assert.deepEqual(pin.previews, savedRange, 'closing the editor cancels its draft');
  await expect(page.locator('#clip-start-frame')).not.toHaveAttribute('src');
  await expect(player).not.toHaveAttribute('src');
  checks.push('bounded board looping; full viewer and all saved items; reload; cancelling draft and releasing media');

  await openEditor(); await editVideo(2);
  const beforeFailure = calls.length;
  await page.getByLabel('Show video 2 in preview', { exact: true }).uncheck();
  await page.locator('#save-pin-edit').click();
  assert.equal(calls.length, beforeFailure);
  await expect(start).toBeDisabled();
  await page.getByLabel('Show video 2 in preview', { exact: true }).check();
  await page.evaluate(() => { window.failPreviewSave = true; });
  await page.locator('#save-pin-edit').click();
  await expect(page.locator('#edit-error')).toHaveText('Saved list unavailable');
  assert.deepEqual(await currentRange(), firstRange);
  await expect(page.getByLabel('Cover item 1', { exact: true })).toBeDisabled();
  assert.deepEqual(pin.previews, savedRange);
  await page.evaluate(() => { window.failPreviewSave = false; });
  await page.locator('#reset-clip').click();
  assert.deepEqual(await currentRange(), { itemId: videoId, start: 0, end: null });
  await checkFrames({ start: 0, end: 12 });
  await page.getByRole('button', { name: 'reset previews', exact: true }).click();
  await expect(page.getByLabel('Show image 1 in preview', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Show video 3 in preview', { exact: true })).toBeChecked();
  await expect(page.locator('#clip-editor')).toBeHidden();
  await closeEditor();
  assert.deepEqual(pin.previews, savedRange);
  checks.push('empty selection blocked; deselected-video sliders disabled; save failure preserves draft; full video/reset and cancellation');

  // Multiple selected videos have independent ranges and different duration limits.
  await openEditor();
  await page.getByLabel('Show video 3 in preview', { exact: true }).check();
  await expect(page.locator('#clip-title')).toHaveText('video 3 · preview range');
  await expect(start).toHaveAttribute('max', '6');
  await expect(start).toBeEnabled();
  await dragHandle(start, 1); await dragHandle(end, 2.5);
  const secondRange = await currentRange();
  assert.ok(Math.abs(secondRange.start - 1) < .025 && Math.abs(secondRange.end - 2.5) < .025, JSON.stringify(secondRange));
  await checkFrames(secondRange);
  await page.locator('#play-clip').click();
  await expect.poll(() => player.evaluate(video => !video.paused)).toBe(true);
  await editVideo(2);
  await expect(player).toBeHidden(); assert.equal(await player.evaluate(video => video.paused), true);
  await expect(start).toHaveAttribute('max', '12');
  assert.deepEqual(await currentRange(), firstRange);
  await checkFrames(firstRange);
  await editVideo(3); assert.deepEqual(await currentRange(), secondRange);
  await editVideo(2); await checkFrames(firstRange);
  await page.locator('#clip-editor').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/video-range-slider.png' });
  await page.locator('#save-pin-edit').click(); await expect(page.locator('#pin-editor')).toBeHidden();
  assert.deepEqual(pin.previews, [firstRange, secondRange]);
  await expect.poll(() => page.locator('.tile-media video').getAttribute('src')).toContain('clip-short.mp4');
  await expect.poll(() => page.locator('.tile-media video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(secondRange.start - .01);
  await page.reload(); await expect(page.locator('.pin')).toHaveCount(1);
  await openEditor(); await editVideo(3);
  assert.deepEqual(await currentRange(), secondRange);
  await editVideo(2); assert.deepEqual(await currentRange(), firstRange);
  await page.locator('#edit-collection').selectOption(offline.id);
  await page.locator('#save-pin-edit').click(); await expect(page.locator('#pin-editor')).toBeHidden();
  assert.deepEqual(queued[0].previews, [firstRange, secondRange]);
  assert.equal(queued[0].coverId, videoId);
  assert.equal(pin.collectionId, online.id);
  checks.push('two selected videos with independent duration limits and ranges; switching pauses playback and updates frames; album playback; reload and queued move preserve both ranges');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/pin-previews-check.json', JSON.stringify({ status: 'passed', display: 'isolated headless Chromium', chromium: browser.version(), checks, limits: 'Preload API is stubbed; native Electron IPC and desktop UI are not exercised.' }, null, 2) + '\n');
  console.log('Preview editing checks passed:', checks.join('; '));
} catch (error) {
  if (page) { await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/pin-previews-failure.png' }); }
  throw error;
} finally { await browser?.close(); await fixture.close(); }
