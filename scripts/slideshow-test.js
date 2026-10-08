import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { newCollection } from '../src/library.js';
import { startFixture } from '../test/fixture.js';

const fixture = await startFixture({ video: true });
const collection = newCollection('image slideshow', { slideshowSeconds: 1 }), other = newCollection('another board');
const red = { id: randomUUID(), kind: 'image', url: `${fixture.url}/red.svg`, previewWidth: 600, previewHeight: 1200 };
const blue = { id: randomUUID(), kind: 'image', url: `${fixture.url}/wide.png`, previewWidth: 3200, previewHeight: 1600 };
const green = { id: randomUUID(), kind: 'image', url: `${fixture.url}/animated.gif`, previewWidth: 32, previewHeight: 24 };
const missing = { ...blue, id: randomUUID(), url: `${fixture.url}/missing` };
const video = { id: randomUUID(), kind: 'video', url: `${fixture.url}/clip.mp4`, previewWidth: 1280, previewHeight: 960 };
const pin = { id: randomUUID(), collectionId: collection.id, title: 'Image slideshow', sourceUrl: `${fixture.url}/album`, coverId: red.id, items: [red, blue, green] };
const state = { collections: [collection, other], pins: [pin] }, errors = [], checks = [];
const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
let browser, releaseBlue, blueRequests = 0, greenRequests = 0;
let blueGate = new Promise(resolve => { releaseBlue = resolve; });
try {
  browser = await chromium.launch({ executablePath: process.env.PAPAN_CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--headless', '--ozone-platform=headless', '--enable-automation'], env });
  const cdp = await browser.newBrowserCDPSession();
  const { arguments: args } = await cdp.send('Browser.getBrowserCommandLine');
  assert.ok(args.some(arg => arg.startsWith('--headless')));
  assert.equal(args.filter(arg => arg.startsWith('--ozone-platform=')).at(-1), '--ozone-platform=headless');
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url() === green.url) greenRequests++; });
  await page.route(blue.url, async route => { blueRequests++; await blueGate; await route.continue(); });
  await page.exposeFunction('readSlideshowLibrary', () => structuredClone(state));
  await page.addInitScript(() => { window.papan = { library: () => window.readSlideshowLibrary(), downloads: async () => [], onDownloads() {}, onProgress() {}, tools: async () => ({}), poseSetup: async () => ({ downloadBytes: 0 }) }; });
  await page.goto(pathToFileURL(path.resolve('src/renderer/index.html')).href);
  const image = page.locator('.tile-media img');
  const readyImage = async source => {
    await expect(image).toHaveAttribute('src', source);
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  };
  const monitorFrames = () => page.evaluate(() => {
    window.slideFrames = { frames: 0, blank: 0, changes: [] };
    function sample() {
      const img = document.querySelector('.tile-media img'), video = document.querySelector('.tile-media video'), frames = window.slideFrames;
      const media = img?.complete && img.naturalWidth ? img : video?.readyState >= 2 && !video.seeking ? video : null;
      frames.frames++;
      if (!media) frames.blank++;
      else if (frames.changes.at(-1)?.src !== media.src) {
        const bounds = media.closest('.pin').getBoundingClientRect();
        frames.changes.push({ src: media.src, time: performance.now(), width: bounds.width, height: bounds.height });
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await readyImage(red.url);
  await monitorFrames();
  await expect.poll(() => blueRequests).toBe(1);
  // Hold the next response beyond a complete slideshow interval.
  await page.waitForTimeout(1300);
  await readyImage(red.url);
  assert.equal(greenRequests, 0, 'a slow image must not be skipped by another timer tick');
  await expect(page.locator('.slide-dot').nth(0)).toHaveClass('slide-dot active');
  releaseBlue();
  await readyImage(blue.url);
  await expect(page.locator('.slide-dot').nth(1)).toHaveClass('slide-dot active');
  await readyImage(green.url);
  await readyImage(red.url);
  const frames = await page.evaluate(() => window.slideFrames);
  assert.equal(frames.blank, 0, 'every sampled frame keeps a loaded image');
  assert.deepEqual(frames.changes.slice(0, 4).map(change => change.src), [red.url, blue.url, green.url, red.url]);
  for (let index = 2; index < 4; index++) assert.ok(frames.changes[index].time - frames.changes[index - 1].time >= 980, 'interval begins when the image becomes visible');
  assert.equal(new Set(frames.changes.map(change => `${change.width}:${change.height}`)).size, 1, 'album dimensions stay fixed');
  checks.push('delayed next image retains the current image and slide dot; no blank frames, skipped slides or shortened intervals');

  pin.items = [red, missing, green];
  await page.reload(); await readyImage(red.url); await monitorFrames();
  await readyImage(green.url);
  assert.equal(await page.evaluate(() => window.slideFrames.blank), 0, 'broken image keeps the previous image until the next valid slide');
  await expect(page.locator('.media-error')).toHaveCount(0);
  pin.items = [missing, green]; pin.coverId = missing.id;
  await page.reload();
  await expect(page.locator('.media-error')).toHaveText('image unavailable');
  await readyImage(green.url);
  checks.push('broken slides preserve an existing image; an unavailable first image shows a fallback and the album recovers');

  pin.items = [red, blue, green]; pin.coverId = red.id;
  blueGate = new Promise(resolve => { releaseBlue = resolve; });
  const beforeSwitch = blueRequests;
  await page.reload(); await readyImage(red.url);
  await expect.poll(() => blueRequests).toBeGreaterThan(beforeSwitch);
  await page.getByRole('tab', { name: other.name, exact: true }).click();
  releaseBlue();
  await expect(page.locator('.pin')).toHaveCount(0);
  await page.getByRole('tab', { name: collection.name, exact: true }).click();
  await readyImage(red.url);
  checks.push('switching collections cancels a pending slide without reviving a removed card');

  pin.items = [video, blue, green, { ...video, id: randomUUID(), poseFor: video.id }]; pin.coverId = video.id;
  pin.previews = [{ itemId: video.id, start: 0, end: .5 }, { itemId: blue.id }, { itemId: green.id }];
  blueGate = new Promise(resolve => { releaseBlue = resolve; });
  const beforeVideo = blueRequests, beforeGreen = greenRequests;
  await page.reload();
  await expect.poll(() => blueRequests).toBeGreaterThan(beforeVideo);
  await page.waitForTimeout(1300);
  await expect(page.locator('.tile-media video')).toHaveCount(1);
  assert.equal(await page.locator('.tile-media video').evaluate(video => video.paused), true);
  await expect(page.locator('.pin-pose')).toHaveAttribute('title', 'view pose');
  assert.equal(await page.locator('.pose-indicator').evaluate(badge => badge.hidden), false, 'pose controls still describe the retained video while the image loads');
  assert.equal(greenRequests, beforeGreen, 'video pause/timeupdate events cannot skip the pending image');
  releaseBlue(); await readyImage(blue.url);
  await expect(page.locator('.pin-pose')).toBeHidden();
  await expect(page.locator('.pose-indicator')).toBeHidden();
  await readyImage(green.url);
  checks.push('video clip endings wait for the next image and preserve mixed-media slide order');

  pin.items = [red, video, green]; pin.coverId = red.id;
  pin.previews = [{ itemId: red.id }, { itemId: video.id, start: .2, end: 1 }, { itemId: green.id }];
  let releaseVideo, videoRequests = 0;
  let videoGate = new Promise(resolve => { releaseVideo = resolve; });
  await page.route(video.url, async route => { videoRequests++; await videoGate; await route.continue(); });
  try {
    await page.reload(); await readyImage(red.url);
    await page.evaluate(() => {
      window.videoTransition = { frames: 0, blank: 0 };
      function sample() {
        const media = document.querySelector('.tile-media'), img = media?.querySelector('img'), video = media?.querySelector('video');
        window.videoTransition.frames++;
        if (!(img?.complete && img.naturalWidth || video?.readyState >= 2 && !video.seeking)) window.videoTransition.blank++;
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await expect.poll(() => videoRequests).toBeGreaterThan(0);
    await page.waitForTimeout(1300);
    await readyImage(red.url);
    await expect(page.locator('.slide-dot').nth(0)).toHaveClass('slide-dot active');
    releaseVideo();
    await expect(page.locator('.tile-media video')).toHaveCount(1);
    await expect.poll(() => page.locator('.tile-media video').evaluate(video => video.readyState >= 2 && !video.seeking && video.currentTime >= .2)).toBe(true);
    assert.equal(await page.evaluate(() => window.videoTransition.blank), 0, 'image-to-video transitions keep a decoded frame while the video loads and seeks');

    videoGate = new Promise(resolve => { releaseVideo = resolve; });
    const beforeCancellation = videoRequests;
    await page.reload(); await readyImage(red.url);
    const cancelledCard = await page.locator('.pin').elementHandle();
    await expect.poll(() => videoRequests).toBeGreaterThan(beforeCancellation);
    await page.getByRole('tab', { name: other.name, exact: true }).click();
    releaseVideo();
    await expect(page.locator('.pin')).toHaveCount(0);
    await page.getByRole('tab', { name: collection.name, exact: true }).click();
    await readyImage(red.url);
    assert.equal(await cancelledCard.evaluate(card => card.isConnected), false, 'a cancelled video load cannot revive the previous board tile');
  } finally { releaseVideo(); await page.unroute(video.url); }
  checks.push('a delayed video keeps the previous image and slide dot until its first decoded frame is ready; switching boards safely cancels pending video loads');

  pin.items = [red, { ...video, url: `${fixture.url}/missing-video` }, green];
  pin.previews = undefined;
  await page.reload(); await readyImage(red.url); await monitorFrames();
  await readyImage(green.url);
  assert.equal(await page.evaluate(() => window.slideFrames.blank), 0, 'a broken video retains the previous image until the next valid slide');
  await expect(page.locator('.media-error')).toHaveCount(0);
  checks.push('a broken video preserves the previous decoded image and the slideshow recovers');

  for (const broken of [missing, { ...video, id: randomUUID(), url: `${fixture.url}/missing-video` }]) {
    pin.items = [video, broken, green]; pin.coverId = video.id;
    pin.previews = [{ itemId: video.id, start: .2, end: .5 }, { itemId: broken.id }, { itemId: green.id }];
    await page.reload();
    await expect.poll(() => page.locator('.tile-media video').evaluate(video => video.readyState >= 2 && !video.seeking && video.currentTime >= .2)).toBe(true);
    await monitorFrames(); await readyImage(green.url);
    assert.equal(await page.evaluate(() => window.slideFrames.blank), 0, 'broken media retains the last decoded video frame until the next valid slide');
    await expect(page.locator('.media-error')).toHaveCount(0);
  }
  checks.push('a broken image or video after a video preserves its last decoded frame and the slideshow recovers');
  assert.deepEqual(errors, []);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/slideshow-check.json', JSON.stringify({ status: 'passed', display: 'isolated headless Chromium', checks, frames, limits: 'Actual renderer and decoded media; preload API stubbed.' }, null, 2) + '\n');
  console.log(checks.join('\n'));
} finally {
  releaseBlue?.();
  if (browser) await browser.close();
  await fixture.close();
}
