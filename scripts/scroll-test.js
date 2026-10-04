import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from 'playwright/test';
import { newCollection } from '../src/library.js';

// Exercise the actual wheel and layout handlers without opening a desktop window.
const collection = newCollection('Scroll check', { density: 3, motion: false });
const state = { collections: [collection], pins: Array.from({ length: 150 }, (_, index) => ({
  id: `pin-${index}`, collectionId: collection.id, title: `Pin ${index}`, sourceUrl: `https://example.com/${index}`, coverId: `item-${index}`,
  items: [{ id: `item-${index}`, kind: 'image', width: 400, height: 300, url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"/>') }],
})) };
const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
const errors = [], checks = [];
const browser = await chromium.launch({ executablePath: process.env.PAPAN_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--headless', '--ozone-platform=headless', '--enable-automation'], env });
try {
  const cdp = await browser.newBrowserCDPSession(), { arguments: args } = await cdp.send('Browser.getBrowserCommandLine');
  assert.ok(args.some(arg => arg.startsWith('--headless')));
  assert.equal(args.filter(arg => arg.startsWith('--ozone-platform=')).at(-1), '--ozone-platform=headless');
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, reducedMotion: 'no-preference' });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(state => {
    window.wheelSaves = [];
    window.papan = {
      library: async () => structuredClone(state), downloads: async () => [], onDownloads() {}, onProgress() {}, tools: async () => ({}),
      setPreviewSize: async input => { state.collections[0].settings.density = input.density; window.wheelSaves.push(input.density); },
      updateCollection: async input => { Object.assign(state.collections[0], { name: input.name, settings: input.settings }); return structuredClone(state.collections[0]); },
    };
  }, state);
  await page.goto(pathToFileURL(path.resolve('src/renderer/index.html')).href);
  await expect(page.locator('.pin')).toHaveCount(48);
  const metrics = () => page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pin')], grid = document.querySelector('#grid'), toolbar = document.querySelector('#toolbar').getBoundingClientRect();
    const tops = [...new Set(cards.map(card => parseFloat(card.style.top)))];
    const row = cards.find(card => card.getBoundingClientRect().bottom > toolbar.bottom + 8);
    const previousBottom = Math.max(-Infinity, ...cards.filter(card => parseFloat(card.style.top) < parseFloat(row?.style.top)).map(card => card.getBoundingClientRect().bottom));
    return { pitch: tops[1] - tops[0], columns: cards.filter(card => parseFloat(card.style.top) === tops[0]).length,
      tileWidth: cards[0]?.getBoundingClientRect().width, origin: scrollY + grid.getBoundingClientRect().top - toolbar.bottom,
      scroll: scrollY, maxScroll: document.documentElement.scrollHeight - innerHeight,
      row: row?.dataset.pinId, rowTop: row?.getBoundingClientRect().top, expectedTop: toolbar.bottom + 8, toolbarBottom: toolbar.bottom, previousBottom };
  });
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const aligned = async pinId => {
    await expect.poll(async () => {
      const m = await metrics();
      const top = pinId ? await page.locator(`[data-pin-id="${pinId}"]`).evaluate(card => card.getBoundingClientRect().top) : m.rowTop;
      return Math.abs(top - m.expectedTop);
    }).toBeLessThanOrEqual(1);
    const m = await metrics();
    assert.ok(m.previousBottom <= m.toolbarBottom, `the previous row stays fully above the board: ${JSON.stringify(m)}`);
  };
  const rowScroll = async row => {
    const m = await metrics();
    await page.mouse.click(5, 200);
    await page.evaluate(top => scrollTo({ top: Math.ceil(top), behavior: 'instant' }), m.origin + row * m.pitch);
    await frames();
    await aligned();
  };
  const zoom = async (delta, saved = true) => {
    const count = await page.evaluate(() => window.wheelSaves.length);
    await page.mouse.move(30, 200); await page.keyboard.down('Control');
    await page.mouse.wheel(0, delta); await page.keyboard.up('Control');
    if (saved) await expect.poll(() => page.evaluate(() => window.wheelSaves.length)).toBe(count + 1);
    await frames();
  };

  await expect.poll(async () => (await metrics()).pitch).toBeGreaterThan(0);
  await rowScroll(3);
  const scrolled = await metrics();
  assert.ok(scrolled.previousBottom <= scrolled.toolbarBottom, 'the previous row stays fully above the board after scrolling');
  checks.push('the row above is fully hidden at rest, including after zoom and window resizing');
  const anchor = (await metrics()).row;
  await zoom(120); await aligned(anchor);
  await zoom(-120); await aligned(anchor);
  await zoom(-120); await aligned(anchor);
  await zoom(120); await aligned(anchor);
  await zoom(120); await aligned(anchor);
  while ((await metrics()).columns < 10) { await zoom(120); await aligned(anchor); }
  assert.equal((await metrics()).scroll, 0, 'smaller previews can place the anchor in the first row');
  while ((await metrics()).columns > 3) { await zoom(-120); await aligned(anchor); }
  assert.equal((await metrics()).row, anchor, 'a zoom round trip retains the original pin');
  checks.push('zoom out/in preserves the top pin, including a round trip through the first row');

  const beforeRapid = await metrics();
  await page.mouse.wheel(0, 120); await page.mouse.wheel(0, 120); await page.mouse.wheel(0, 120);
  const target = beforeRapid.origin + Math.round((beforeRapid.scroll - beforeRapid.origin) / beforeRapid.pitch + 3) * beforeRapid.pitch;
  await expect.poll(async () => Math.abs((await metrics()).scroll - target)).toBeLessThanOrEqual(1);
  await aligned();
  await page.mouse.wheel(0, -120); await zoom(120);
  const during = await metrics(), animationAnchor = during.row;
  await aligned(animationAnchor);
  // Wait longer than Chromium's smooth scroll to catch a stale destination resuming.
  await page.waitForTimeout(600); await aligned(animationAnchor);
  await page.mouse.wheel(0, 120);
  const next = during.origin + Math.round((during.scroll - during.origin) / during.pitch + 1) * during.pitch;
  await expect.poll(async () => Math.abs((await metrics()).scroll - next)).toBeLessThanOrEqual(1);
  checks.push('rapid smooth wheel input accumulates rows; zoom cancels the previous animation');

  await rowScroll(0);
  const firstRow = await metrics();
  const saves = await page.evaluate(() => window.wheelSaves.length);
  await page.evaluate(() => {
    const grid = document.querySelector('#grid');
    for (const ctrlKey of [false, true, true]) grid.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 30, clientY: 200, deltaY: 120, ctrlKey }));
  });
  await expect.poll(() => page.evaluate(() => window.wheelSaves.length)).toBe(saves + 1);
  await page.waitForTimeout(600);
  assert.notEqual((await metrics()).pitch, firstRow.pitch, 'the zoom changes the row geometry');
  assert.equal((await metrics()).scroll, 0, 'zoom cancels a scroll even before the animation leaves the first row');
  await zoom(-120); await zoom(-120);
  checks.push('zoom before the first animation frame clears the old destination');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await rowScroll(3);
  const partial = await metrics();
  await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), partial.scroll + partial.pitch * 0.4);
  await page.mouse.wheel(0, 120); await aligned();
  assert.ok(Math.abs((await metrics()).scroll - (partial.origin + 4 * partial.pitch)) <= 1);
  await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), partial.scroll + partial.pitch * 0.4);
  await page.mouse.wheel(0, -120); await aligned();
  assert.ok(Math.abs((await metrics()).scroll - (partial.origin + 3 * partial.pitch)) <= 1);
  checks.push('partial scroll positions land on the next row boundary in either direction');

  const resizeAnchor = (await metrics()).row;
  await page.setViewportSize({ width: 900, height: 700 }); await frames(); await aligned(resizeAnchor);
  await page.setViewportSize({ width: 1200, height: 700 }); await frames(); await aligned(resizeAnchor);
  await page.locator('#collection-settings').click();
  const size = page.locator('#preview-size');
  await size.press('ArrowLeft'); await frames(); await aligned(resizeAnchor);
  await size.press('ArrowRight'); await frames(); await aligned(resizeAnchor);
  await page.locator('[data-close="settings-dialog"]').click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await page.mouse.move(30, 200); await page.mouse.wheel(0, 120); await aligned();
  checks.push('window resize and live preview-size controls preserve the top row');

  await page.locator('#toggle-search').click(); await page.locator('#search').fill('Pin'); await page.locator('#search').press('Escape');
  await expect(page.locator('#search-summary')).toBeVisible(); await frames();
  await rowScroll(2);
  const searchAnchor = (await metrics()).row;
  await zoom(120); await aligned(searchAnchor);
  await page.mouse.wheel(0, 120); await aligned();
  checks.push('filtered search rows account for the summary above the grid');

  while (await page.locator('.pin').count() < state.pins.length) {
    await page.mouse.click(5, 200);
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await frames();
  }
  await frames();
  const last = page.locator('.pin').last();
  const lastRow = await last.evaluate(card => Math.ceil(scrollY + card.getBoundingClientRect().top - document.querySelector('#toolbar').getBoundingClientRect().bottom - 8));
  await page.mouse.click(5, 200);
  await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), lastRow);
  await aligned(await last.getAttribute('data-pin-id'));
  const bottomAnchor = (await metrics()).row;
  await zoom(-120); await aligned(bottomAnchor);
  const resizedLastRow = await last.evaluate(card => Math.ceil(scrollY + card.getBoundingClientRect().top - document.querySelector('#toolbar').getBoundingClientRect().bottom - 8));
  await page.mouse.click(5, 200);
  await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), resizedLastRow);
  await aligned(await last.getAttribute('data-pin-id'));
  await page.mouse.wheel(0, -120); await aligned();
  checks.push('lazy loading and bottom blank space still let the final row reach the top');

  for (const width of [560, 900, 1200, 1920, 2560, 3840]) {
    await page.setViewportSize({ width, height: 700 }); await page.reload(); await frames();
    await page.locator('#collection-settings').click();
    await size.press('Home'); await frames();
    const smallest = (await metrics()).tileWidth;
    await size.press('End'); await frames();
    const largest = (await metrics()).tileWidth;
    await page.locator('[data-close="settings-dialog"]').click();
    await expect(page.locator('#settings-dialog')).toBeHidden(); await frames();
    for (const [direction, endpoint] of [[120, smallest], [-120, largest]]) {
      let steps = 0;
      while (Math.abs((await metrics()).tileWidth - endpoint) > 0.1) {
        const before = await metrics();
        await zoom(direction, false);
        const after = await metrics();
        assert.ok(direction > 0 ? after.tileWidth < before.tileWidth : after.tileWidth > before.tileWidth, `${width}px: each Ctrl+wheel step visibly changes preview size`);
        assert.ok(++steps < 40, 'the full zoom range stays reachable');
      }
      await rowScroll(2);
      await page.mouse.move(30, 200); await page.mouse.wheel(0, 120); await aligned();
      await page.mouse.wheel(0, -120); await aligned();
      while (await page.locator('.pin').count() < state.pins.length) {
        await page.mouse.click(5, 200);
        await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
        await frames();
      }
      const bottom = await page.locator('.pin').last().evaluate(card => Math.ceil(scrollY + card.getBoundingClientRect().top - document.querySelector('#toolbar').getBoundingClientRect().bottom - 8));
      await page.mouse.click(5, 200);
      await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), bottom);
      await aligned(await page.locator('.pin').last().getAttribute('data-pin-id'));
      await page.waitForTimeout(250);
      const beforeLimit = await page.evaluate(async () => ({ saves: window.wheelSaves.length, settings: (await window.papan.library()).collections[0].settings }));
      await zoom(direction, false); await page.waitForTimeout(250);
      assert.equal((await metrics()).tileWidth, endpoint, `${width}px: zoom stops at the visible limit`);
      assert.deepEqual(await page.evaluate(async () => ({ saves: window.wheelSaves.length, settings: (await window.papan.library()).collections[0].settings })), beforeLimit, 'a zoom limit neither changes settings nor saves');
      assert.ok(Number.isInteger(beforeLimit.settings.density * 2), 'adaptive levels keep the saved density format');
    }
  }
  checks.push('every Ctrl+wheel step changes layout at 560–3840px; both visible limits stop without extra saves');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', display: 'isolated headless Chromium', checks, limits: 'Actual renderer with stubbed preload; native Electron wheel input not exercised.' }, null, 2));
} finally { await browser.close(); }
