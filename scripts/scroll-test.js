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
    if (location.search === '?delayed-previews') for (const pin of state.pins.slice(0, 2)) {
      delete pin.items[0].width; delete pin.items[0].height;
      pin.items[0].url = `http://papan.test/late-preview-${pin.id}.svg`;
    }
    window.wheelSaves = [];
    window.testLibrary = state;
    window.libraryReads = 0;
    window.pendingLibraries = [];
    window.papan = {
      library: async () => {
        window.libraryReads++;
        const snapshot = structuredClone(state);
        return window.holdLibrary ? new Promise(resolve => window.pendingLibraries.push(() => resolve(snapshot))) : snapshot;
      }, downloads: async () => [],
      onDownloads: callback => { window.testDownloads = callback; }, onPhoneInbox: callback => { window.testPhoneInbox = callback; },
      onProgress() {}, tools: async () => ({}),
      setPreviewSize: async input => { state.collections[0].settings.density = input.density; window.wheelSaves.push(input.density); },
      updateCollection: async input => { Object.assign(state.collections[0], { name: input.name, settings: input.settings }); return structuredClone(state.collections[0]); },
      saveCollection: async ({ id }) => {
        const saved = structuredClone(state.collections.find(collection => collection.id === id));
        return window.holdSaveCollection ? new Promise(resolve => { window.releaseSaveCollection = () => resolve(saved); }) : saved;
      },
      openCollection: async () => structuredClone(state.collections.find(collection => collection.id === 'other-board')),
      reorder: async ({ kind, id, beforeId }) => {
        const items = state[kind === 'pin' ? 'pins' : 'collections'], [moving] = items.splice(items.findIndex(item => item.id === id), 1);
        items.splice(beforeId === null ? items.length : items.findIndex(item => item.id === beforeId), 0, moving);
        return structuredClone(state);
      },
      clearCollectionHistory: async () => { state.hiddenRecentCollections = state.collections.filter(collection => collection.closed).map(collection => collection.id); },
    };
  }, state);
  const url = pathToFileURL(path.resolve('src/renderer/index.html')).href;
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

  let releases, requests;
  await page.route('http://papan.test/late-preview-*.svg', async route => {
    const index = route.request().url().includes('pin-0') ? 0 : 1;
    requests.add(index);
    await releases[index].gate;
    await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${index ? 200 : 800}"/>` });
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    releases = Array.from({ length: 2 }, () => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      return { gate, release };
    });
    requests = new Set();
    await page.goto(`${url}?delayed-previews`);
    await expect(page.locator('.pin')).toHaveCount(48);
    await expect.poll(() => requests.size).toBe(2);
    await expect.poll(async () => (await metrics()).pitch).toBeGreaterThan(0);
    await page.mouse.move(30, 200); await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => scrollY > 0);
    releases[0].release();
    await expect(page.locator('[data-pin-id="pin-0"] img')).toHaveCount(1);
    await aligned('pin-3');
    await page.waitForTimeout(600); await aligned('pin-3');

    if (attempt === 0) {
      await page.evaluate(() => {
        window.delayedCard = document.querySelector('[data-pin-id="pin-0"]');
        window.delayedImage = window.delayedCard.querySelector('img');
        window.pendingCard = document.querySelector('[data-pin-id="pin-1"]');
        const other = structuredClone(window.testLibrary.collections[0]); other.id = 'background-board';
        window.testLibrary.collections.push(other);
        const pin = structuredClone(window.testLibrary.pins[0]); pin.id = 'background-pin'; pin.collectionId = other.id;
        window.testLibrary.pins.push(pin);
        window.testDownloads([{ id: 'background-save', title: 'Save to another board', state: 'completed' }]);
      });
      await expect(page.locator('.collection-tab')).toHaveCount(2);
      await frames(); await aligned('pin-3');
      assert.equal(await page.evaluate(() => window.delayedImage.isConnected && window.pendingCard === document.querySelector('[data-pin-id="pin-1"]')), true, 'a background save retains measured previews and pending decoding');
      checks.push('saves to another collection retain measured dimensions and in-flight preview decoding');
    }

    const before = await metrics();
    await page.mouse.wheel(0, 120); await page.mouse.wheel(0, 120); await page.mouse.wheel(0, 120);
    await page.waitForFunction(top => scrollY > top, before.scroll);
    releases[1].release();
    await expect(page.locator('[data-pin-id="pin-1"] img')).toHaveCount(1);
    await aligned('pin-12');
    await page.waitForTimeout(600); await aligned('pin-12');
  }
  await page.unrouteAll({ behavior: 'wait' });
  checks.push('late startup previews preserve the destination of the first wheel scroll and accumulated wheel input (3 attempts)');

  await page.goto(url);
  await expect(page.locator('.pin')).toHaveCount(48);
  while (await page.locator('.pin').count() < state.pins.length) {
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await frames();
  }
  await rowScroll(35);
  const livePosition = await metrics();
  await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), livePosition.scroll + livePosition.pitch * .3);
  await frames();
  const liveAnchor = (await metrics()).row;
  const anchorCard = page.locator(`[data-pin-id="${liveAnchor}"]`);
  await expect(anchorCard.locator('img')).toHaveCount(1);
  await page.evaluate(id => {
    window.retainedCard = document.querySelector(`[data-pin-id="${id}"]`);
    window.retainedImage = window.retainedCard.querySelector('img');
    window.retainedTop = window.retainedCard.getBoundingClientRect().top;
    window.boardMutations = [];
    new MutationObserver(records => window.boardMutations.push(...records.filter(record => [...record.removedNodes].some(node => node === window.retainedCard || node === window.retainedImage))))
      .observe(document.querySelector('#grid'), { childList: true, subtree: true });
    const pin = structuredClone(window.testLibrary.pins[0]);
    Object.assign(pin, { id: 'downloaded-pin', title: 'New downloaded pin', sourceUrl: 'https://example.com/new' });
    window.testLibrary.pins.push(pin);
    window.testDownloads([{ id: 'save-1', title: pin.title, state: 'completed' }]);
  }, liveAnchor);
  await expect(page.locator('.pin')).toHaveCount(151);
  await frames();
  assert.equal(await page.evaluate(() => window.retainedCard.isConnected && window.retainedImage.isConnected), true, 'a completed download retains existing tiles and decoded previews');
  assert.equal(await page.evaluate(() => window.boardMutations.length), 0, 'the visible tile and preview are never removed during the update');
  assert.ok(await page.evaluate(() => Math.abs(window.retainedCard.getBoundingClientRect().top - window.retainedTop) <= 1), 'a download preserves a partial scroll position beyond the first lazy-loaded batch');
  checks.push('new downloads keep existing tiles, decoded images, loaded batches, and partial scroll positions');

  const reads = await page.evaluate(() => window.libraryReads);
  await page.evaluate(() => window.testDownloads([{ id: 'save-1', title: 'New downloaded pin', state: 'completed' }, { id: 'save-2', title: 'Next save', state: 'running' }]));
  await frames();
  assert.equal(await page.evaluate(() => window.libraryReads), reads, 'later queue progress does not refresh an already completed download');
  checks.push('completed downloads refresh once when later queue events arrive');

  await page.evaluate(() => {
    const pin = structuredClone(window.testLibrary.pins[0]);
    Object.assign(pin, { id: 'phone-pin', title: 'New portrait from phone', sourceUrl: 'https://example.com/phone' });
    pin.items[0].width = 400; pin.items[0].height = 800;
    window.testLibrary.pins.push(pin);
    window.testPhoneInbox({ running: false, devices: [], entries: [{ id: 'share-1', title: pin.title, state: 'saved' }] });
  });
  await expect(page.locator('.pin')).toHaveCount(152);
  await frames();
  assert.equal(await page.evaluate(() => window.retainedImage.isConnected), true, 'phone saves retain decoded previews');
  assert.ok(await page.evaluate(() => Math.abs(window.retainedCard.getBoundingClientRect().top - window.retainedTop) <= 1), 'a phone save with a different aspect ratio preserves the visible tile offset');
  checks.push('phone saves with different image proportions preserve the visible tile and its viewport offset');

  for (const [attempt, [delay, direction]] of [[0, 1], [100, 1], [0, -1], [100, -1]].entries()) {
    await rowScroll(35);
    const before = await metrics();
    await expect(page.locator(`[data-pin-id="${before.row}"] img`)).toHaveCount(1);
    await page.evaluate(direction => {
      window.scrollingCard = [...document.querySelectorAll('.pin')].find(card => card.getBoundingClientRect().bottom > document.querySelector('#toolbar').getBoundingClientRect().bottom + 8);
      window.scrollingImage = window.scrollingCard.querySelector('img');
      for (let step = 0; step < 3; step++) document.querySelector('#grid').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 30, clientY: 200, deltaY: direction * 120 }));
    }, direction);
    if (delay) await page.waitForTimeout(delay);
    await page.evaluate(attempt => {
      const pin = structuredClone(window.testLibrary.pins[0]);
      Object.assign(pin, { id: `scrolling-pin-${attempt}`, title: 'Saved while scrolling' });
      pin.items[0].height = 800;
      window.testLibrary.pins.push(pin);
      window.testDownloads([{ id: `scrolling-save-${attempt}`, title: pin.title, state: 'completed' }]);
    }, attempt);
    await expect(page.locator('.pin')).toHaveCount(153 + attempt);
    await frames();
    assert.ok(((await metrics()).scroll - before.scroll) * direction < before.pitch * 2, 'saving different image proportions does not jump to the pending smooth-scroll destination');
    assert.equal(await page.evaluate(() => window.scrollingCard.isConnected && window.scrollingImage.isConnected), true, 'a save during scrolling retains the visible tile and decoded image');
    await page.mouse.move(30, 200); await page.mouse.wheel(0, direction * 120);
    const destination = `pin-${(35 + direction * 4) * before.columns}`;
    await expect.poll(async () => (await metrics()).pitch).toBeGreaterThan(before.pitch);
    await aligned(destination);
    await page.waitForTimeout(600); await aligned(destination);
  }
  checks.push('saves before and during smooth scrolling preserve the animation, decoded previews, and accumulated wheel destination in both directions');

  // Background updates must not discard a newer snapshot or the user's current board.
  await page.goto(url);
  await expect(page.locator('.pin')).toHaveCount(48);
  await page.evaluate(() => {
    window.holdLibrary = true;
    const pin = structuredClone(window.testLibrary.pins[0]); pin.id = 'first-concurrent-pin';
    window.testLibrary.pins.push(pin);
    window.testDownloads([{ id: 'first-concurrent-save', title: pin.title, state: 'completed' }]);
    window.testLibrary.pins.push({ ...pin, id: 'second-concurrent-pin' });
    window.testDownloads([{ id: 'second-concurrent-save', title: pin.title, state: 'completed' }]);
  });
  await expect.poll(() => page.evaluate(() => window.pendingLibraries.length)).toBe(2);
  await page.evaluate(() => window.pendingLibraries[1]());
  await expect(page.locator('#end-note')).toContainText('152 pins');
  await page.evaluate(() => { window.pendingLibraries[0](); window.holdLibrary = false; });
  await frames();
  await expect(page.locator('#end-note')).toContainText('152 pins');
  checks.push('an older refresh arriving last cannot remove pins from a newer snapshot');

  await page.evaluate(() => {
    window.holdLibrary = true; window.pendingLibraries = [];
    window.testDownloads([{ id: 'before-reorder-save', title: 'Background save', state: 'completed' }]);
  });
  await expect.poll(() => page.evaluate(() => window.pendingLibraries.length)).toBe(1);
  await page.locator('[data-pin-id="pin-0"] .tile-main').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('.pin').first()).toHaveAttribute('data-pin-id', 'pin-1');
  await page.evaluate(() => { window.pendingLibraries[0](); window.holdLibrary = false; });
  await frames();
  await expect(page.locator('.pin').first()).toHaveAttribute('data-pin-id', 'pin-1');
  checks.push('a refresh started before reordering cannot undo the saved order');

  await page.evaluate(() => {
    const other = structuredClone(window.testLibrary.collections[0]); other.id = 'other-board'; other.name = 'Other board';
    window.testLibrary.collections.push(other, { ...other, id: 'closed-board', name: 'Closed board', closed: true });
    window.testLibrary.pins.push({ ...structuredClone(window.testLibrary.pins[0]), id: 'other-board-pin', collectionId: other.id });
    window.testDownloads([{ id: 'other-board-save', title: 'Other board', state: 'completed' }]);
  });
  await expect(page.locator('.collection-tab')).toHaveCount(2);
  await page.evaluate(() => { window.holdLibrary = true; window.pendingLibraries = []; });
  await page.locator('#open-collection').click(); await page.locator('#browse-collection').click();
  await expect.poll(() => page.evaluate(() => window.pendingLibraries.length)).toBe(1);
  await page.evaluate(() => window.testDownloads([{ id: 'during-open-save', title: 'Background save', state: 'completed' }]));
  await expect.poll(() => page.evaluate(() => window.pendingLibraries.length)).toBe(2);
  await page.evaluate(() => window.pendingLibraries[1]());
  await frames();
  await expect(page.locator('.collection-tab[aria-selected="true"]')).toHaveText(collection.name);
  await page.evaluate(() => { window.pendingLibraries[0](); window.holdLibrary = false; });
  await expect(page.locator('.collection-tab[aria-selected="true"]')).toHaveText('Other board');
  await expect(page.locator('#save-collection-file')).toBeEnabled();
  await page.getByRole('tab', { name: collection.name, exact: true }).click();
  checks.push('a newer background refresh preserves a pending foreground request to open another board');

  await page.evaluate(() => { window.holdLibrary = true; window.pendingLibraries = []; });
  await page.locator('#save-collection-file').click();
  await expect.poll(() => page.evaluate(() => window.pendingLibraries.length)).toBe(1);
  await page.getByRole('tab', { name: 'Other board', exact: true }).click();
  await expect(page.locator('[data-pin-id="other-board-pin"]')).toBeVisible();
  await page.evaluate(() => { window.pendingLibraries[0](); window.holdLibrary = false; });
  await expect(page.locator('#save-collection-file')).toBeEnabled();
  await expect(page.locator('.collection-tab[aria-selected="true"]')).toHaveText('Other board');
  await expect(page.locator('[data-pin-id="other-board-pin"]')).toBeVisible();
  checks.push('a delayed save refresh cannot switch back after the user chooses another board');

  await page.getByRole('tab', { name: collection.name, exact: true }).click();
  await page.evaluate(() => { window.holdSaveCollection = true; });
  await page.locator('#save-collection-file').click();
  await page.getByRole('tab', { name: 'Other board', exact: true }).click();
  await page.evaluate(() => { window.releaseSaveCollection(); window.holdSaveCollection = false; });
  await expect(page.locator('#save-collection-file')).toBeEnabled();
  await expect(page.locator('.collection-tab[aria-selected="true"]')).toHaveText('Other board');
  checks.push('changing boards while saving the list also preserves the newer selection');

  await page.getByRole('tab', { name: 'Other board', exact: true }).focus();
  await page.evaluate(() => {
    window.retainedTab = document.activeElement;
    window.testDownloads([{ id: 'unchanged-tabs-save', title: 'Background save', state: 'completed' }]);
  });
  await frames();
  assert.equal(await page.evaluate(() => window.retainedTab.isConnected && document.activeElement === window.retainedTab), true, 'an unchanged tab bar keeps its nodes and keyboard focus during refresh');
  checks.push('unchanged collection tabs retain their DOM nodes and keyboard focus during background refreshes');

  await page.keyboard.press('Control+t');
  const temporaryId = await page.locator('.collection-tab[aria-selected="true"]').getAttribute('data-collection-id');
  await page.getByRole('tab', { name: collection.name, exact: true }).click();
  while (await page.locator('.pin').count() < 152) {
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await frames();
  }
  await rowScroll(35);
  await expect(page.locator('[data-pin-id="pin-105"] img')).toHaveCount(1);
  const stableScroll = (await metrics()).scroll;
  await page.evaluate(() => {
    window.backgroundCard = document.querySelector('[data-pin-id="pin-105"]');
    window.backgroundImage = window.backgroundCard.querySelector('img');
  });
  await page.locator(`[data-close-collection="${temporaryId}"]`).click();
  await expect(page.locator('.pin')).toHaveCount(152);
  await frames();
  assert.equal(await page.evaluate(() => window.backgroundCard.isConnected && window.backgroundImage.isConnected), true, 'closing a background temporary tab keeps the visible preview');
  assert.ok(Math.abs((await metrics()).scroll - stableScroll) <= 1, 'closing a background temporary tab keeps the loaded rows and scroll position');
  await page.locator('#open-collection').click();
  await page.locator('#clear-collection-history').click();
  await expect(page.locator('#collection-file-status')).toContainText('History cleared');
  await expect(page.locator('.pin')).toHaveCount(152);
  assert.equal(await page.evaluate(() => window.backgroundImage.isConnected), true, 'clearing recent history keeps the board preview');
  await page.keyboard.press('Escape'); await frames();
  assert.ok(Math.abs((await metrics()).scroll - stableScroll) <= 1, 'clearing recent history keeps the board scroll position');
  checks.push('closing a background temporary tab and clearing recent history retain previews, loaded rows, and scrolling');

  await page.goto(url);
  await expect(page.locator('.pin')).toHaveCount(48);
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
