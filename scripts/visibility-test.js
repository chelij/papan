import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { newCollection } from '../src/library.js';
import { startFixture } from '../test/fixture.js';

// Actual renderer and decoded media, isolated from the desktop/personal library.
const fixture = await startFixture({ video: true });
const collection = newCollection('visibility', { density: 2 });
const pins = Array.from({ length: 20 }, (_, index) => {
  const id = randomUUID();
  return { id: randomUUID(), collectionId: collection.id, title: `Video ${index + 1}`, sourceUrl: `${fixture.url}/video-${index}`,
    coverId: id, items: [{ id, kind: 'video', url: `${fixture.url}/clip.mp4`, previewWidth: 1280, previewHeight: 960 }] };
});
pins[0].previews = [{ itemId: pins[0].coverId, start: .5, end: null }];
const state = { collections: [collection], pins }, errors = [], checks = [];
const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PAPAN_CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--headless', '--ozone-platform=headless', '--enable-automation'], env });
  const cdp = await browser.newBrowserCDPSession();
  const { arguments: args } = await cdp.send('Browser.getBrowserCommandLine');
  assert.ok(args.includes('--ozone-platform=headless') && args.some(arg => arg.startsWith('--headless')));
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(state => {
    window.papan = { library: async () => state, downloads: async () => [], onDownloads() {}, onProgress() {}, tools: async () => ({}),
      onWindowVisibility: callback => { window.testWindowVisibility = callback; },
      setPreviewSize: async ({ density }) => { state.collections[0].settings.density = density; } };
    // Renderer-level hidden-document check; native Electron hiding is checked separately.
    window.testHidden = false;
    Object.defineProperty(document, 'hidden', { get: () => window.testHidden });
  }, state);
  await page.goto(pathToFileURL(path.resolve('src/renderer/index.html')).href);
  await expect(page.locator('.pin')).toHaveCount(20);
  const card = page.locator('.pin').first(), video = card.locator('video');
  await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > .3)).toBe(true);
  const original = await video.elementHandle();
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.evaluate(() => window.scrollTo(0, 1400));
    await expect.poll(() => video.evaluate(v => v.paused)).toBe(true);
    const stopped = await video.evaluate(v => ({ time: v.currentTime, src: v.src }));
    await page.waitForTimeout(550);
    assert.ok(Math.abs(await video.evaluate(v => v.currentTime) - stopped.time) < .05, 'off-screen playback time stays fixed');
    assert.ok(stopped.time > .2 && stopped.src, 'off-screen preview retains position and source');
    assert.equal(await original.evaluate(v => v === document.querySelector('.pin video')), true, 'returning uses the same video');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => video.evaluate((v, time) => !v.paused && v.currentTime > time + .15, stopped.time)).toBe(true);
  }
  checks.push('three scroll-out/scroll-in cycles pause playback and resume the same video from its retained position');

  const enteringCard = page.locator('.pin').nth(6), enteringVideo = enteringCard.locator('video');
  const edgeScroll = await enteringCard.evaluate(card => scrollY + card.getBoundingClientRect().top - innerHeight);
  await page.evaluate(top => window.scrollTo(0, top), edgeScroll);
  await expect(enteringVideo).toHaveCount(1);
  await expect.poll(() => enteringVideo.evaluate(v => v.paused)).toBe(true);
  await page.waitForTimeout(100); // Deliver the observer's initial edge contact.
  await page.evaluate(() => window.scrollBy(0, 200));
  await expect.poll(() => enteringVideo.evaluate(v => !v.paused && v.currentTime > .2)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => video.evaluate(v => !v.paused)).toBe(true);

  const edgeOffset = await video.evaluate(v => innerHeight - v.getBoundingClientRect().top);
  await card.evaluate((card, offset) => { card.style.transform = `translateY(${offset + 20}px)`; }, edgeOffset);
  await expect.poll(() => video.evaluate(v => v.paused)).toBe(true);
  await card.evaluate((card, offset) => { card.style.transform = `translateY(${offset}px)`; }, edgeOffset);
  await page.waitForTimeout(100);
  assert.equal(await video.evaluate(v => v.getBoundingClientRect().top), 900, 'video touches the viewport edge');
  const edgeTime = await video.evaluate(v => v.currentTime);
  await card.evaluate(card => { card.style.transform = ''; });
  await expect.poll(() => video.evaluate((v, time) => !v.paused && v.currentTime > time + .15, edgeTime)).toBe(true);
  checks.push('rows entering through the viewport edge start playing; returning through a zero-area edge contact resumes retained playback');

  for (let cycle = 0; cycle < 2; cycle++) {
    await video.evaluate(v => { v.currentTime = v.duration - .1; });
    await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime >= .5 && v.currentTime < 3)).toBe(true);
  }
  checks.push('single-video previews with an unbounded end loop at their saved start after natural endings');

  // Leave one pixel exposed below the sticky toolbar, then move fully behind it.
  await card.evaluate(card => window.scrollBy(0, card.getBoundingClientRect().bottom - document.getElementById('toolbar').getBoundingClientRect().bottom - 1));
  await expect.poll(() => video.evaluate(v => !v.paused)).toBe(true);
  await page.evaluate(() => window.scrollBy(0, 2));
  await expect.poll(() => video.evaluate(v => v.paused)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => video.evaluate(v => !v.paused)).toBe(true);
  const transform = await card.evaluate(card => {
    const top = document.getElementById('board-footer').getBoundingClientRect().top;
    return top - card.getBoundingClientRect().top + 1;
  });
  await card.evaluate((card, y) => { card.style.transform = `translateY(${y}px)`; }, transform);
  await expect.poll(() => video.evaluate(v => v.paused)).toBe(true);
  await card.evaluate(card => { card.style.transform = ''; });
  await expect.poll(() => video.evaluate(v => !v.paused)).toBe(true);
  checks.push('even one visible pixel can play; previews fully covered by the sticky header/footer pause, including transformed cards');

  await video.evaluate(v => v.pause());
  const manualTime = await video.evaluate(v => v.currentTime);
  await page.waitForTimeout(900); // More than two slideshow timer ticks.
  assert.equal(await video.evaluate(v => v.paused), true);
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(600);
  assert.equal(await video.evaluate(v => v.paused), true);
  assert.ok(Math.abs(await video.evaluate(v => v.currentTime) - manualTime) < .05);
  checks.push('an explicit pause survives timer ticks, visibility changes and reduced-motion preference changes');
  await video.evaluate(v => v.play());
  await expect.poll(() => video.evaluate(v => !v.paused)).toBe(true);

  const hidden = value => page.evaluate(value => { window.testHidden = value; document.dispatchEvent(new Event('visibilitychange')); }, value);
  await page.evaluate(() => window.testWindowVisibility(false));
  assert.equal(await video.evaluate(v => v.paused), true, 'native hidden-window signal pauses with document.hidden false');
  await page.evaluate(() => window.testWindowVisibility(true));
  await expect.poll(() => video.evaluate(v => !v.paused)).toBe(true);
  await hidden(true);
  assert.equal(await video.evaluate(v => v.paused), true, 'visibilitychange pauses synchronously');
  await hidden(false);
  await expect.poll(() => video.evaluate(v => !v.paused)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => video.evaluate(v => v.paused)).toBe(true);
  await hidden(true); await hidden(false);
  assert.equal(await video.evaluate(v => v.paused), true, 'returning does not override reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => video.evaluate(v => !v.paused)).toBe(true);
  checks.push('native-window and hidden-document events pause immediately; automatic resumption respects reduced motion');

  await page.mouse.move(550, 350); await page.keyboard.down('Control'); await page.mouse.wheel(0, 100); await page.keyboard.up('Control');
  await expect.poll(() => card.evaluate(card => card.clientWidth)).toBeLessThan(500);
  await page.setViewportSize({ width: 800, height: 560 });
  await page.waitForTimeout(700);
  const offscreenPlaying = await page.locator('.tile-media video').evaluateAll(videos => videos.filter(video => {
    const bounds = video.getBoundingClientRect(), top = document.getElementById('toolbar').getBoundingClientRect().bottom,
      bottom = document.getElementById('board-footer').getBoundingClientRect().top;
    return !video.paused && (bounds.bottom <= top || bounds.top >= bottom || bounds.right <= 0 || bounds.left >= innerWidth);
  }).length);
  assert.equal(offscreenPlaying, 0);
  checks.push('Ctrl-wheel preview resizing and viewport resize leave no off-screen video playing');
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await card.locator('.tile-main').click();
  const viewer = page.locator('#viewer-media video');
  await expect.poll(() => viewer.evaluate(v => !v.paused && v.currentTime > .2)).toBe(true);
  await expect.poll(() => video.evaluate(v => v.paused)).toBe(true);
  await hidden(true); assert.equal(await viewer.evaluate(v => v.paused), true);
  await hidden(false); await expect.poll(() => viewer.evaluate(v => !v.paused)).toBe(true);
  await viewer.evaluate(v => v.pause());
  await hidden(true); await hidden(false);
  await page.waitForTimeout(600);
  assert.equal(await viewer.evaluate(v => v.paused), true, 'manual viewer pause survives hiding');
  await viewer.evaluate(v => v.play());
  await viewer.evaluate(v => { v.style.transform = 'translateY(2000px)'; });
  await expect.poll(() => viewer.evaluate(v => v.paused)).toBe(true);
  const viewerTime = await viewer.evaluate(v => v.currentTime);
  await viewer.evaluate(v => { v.style.transform = ''; });
  await expect.poll(() => viewer.evaluate((v, time) => !v.paused && v.currentTime > time + .15, viewerTime)).toBe(true);
  checks.push('viewer playback suspends off-screen and when hidden, resumes at its position, and preserves explicit pauses');
  await page.locator('#edit-pin').click();
  await page.getByRole('button', { name: 'Edit video 1 preview', exact: true }).click();
  const player = page.locator('#clip-player');
  await page.locator('#play-clip').click();
  await player.scrollIntoViewIfNeeded();
  await expect.poll(() => player.evaluate(v => !v.paused)).toBe(true);
  await hidden(true); assert.equal(await player.evaluate(v => v.paused), true);
  await hidden(false); await expect.poll(() => player.evaluate(v => !v.paused)).toBe(true);
  await page.locator('#edit-covers').scrollIntoViewIfNeeded();
  await page.locator('#pin-editor').evaluate(dialog => { dialog.scrollTop = 0; });
  // A transform also checks the editor's clipping ancestor without relying on dialog size.
  await player.evaluate(v => { v.style.transform = 'translateY(2000px)'; });
  await expect.poll(() => player.evaluate(v => v.paused)).toBe(true);
  await player.evaluate(v => { v.style.transform = ''; });
  await player.scrollIntoViewIfNeeded();
  await expect.poll(() => player.evaluate(v => !v.paused)).toBe(true);
  await player.evaluate(v => v.pause());
  await hidden(true); await hidden(false);
  await page.waitForTimeout(500);
  assert.equal(await player.evaluate(v => v.paused), true);
  assert.equal(await page.locator('#clip-start-frame').evaluate(v => v.paused), true);
  assert.equal(await page.locator('#clip-end-frame').evaluate(v => v.paused), true);
  checks.push('clip playback suspends/resumes without restarting; manual pauses and static boundary frames stay paused');
  assert.deepEqual(errors, []);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/visibility-check.json', JSON.stringify({ status: 'passed', display: 'isolated headless Chromium', checks,
    limits: 'Actual renderer and decoded videos; preload stubbed. Hidden-document events are simulated here; native Electron window visibility is a separate check. App supports scrolling/preview resizing rather than a separate pan/zoom canvas.' }, null, 2) + '\n');
  console.log(checks.join('\n'));
} finally { await browser?.close(); await fixture.close(); }
