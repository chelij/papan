import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { openLibrary, newCollection } from '../src/library.js';
import { mediaLocation } from '../src/collection-files.js';
import { fileResponse } from '../src/file-response.js';
import { openDownloadQueue } from '../src/download-queue.js';
import { startFixture } from '../test/fixture.js';

// Real renderer, library, encryption, queue and ranged media response. Only the
// Electron IPC boundary and scheme registration are replaced for headless QA.
const root = await mkdtemp(path.join(os.tmpdir(), 'papan-protection-ui-'));
let library = await openLibrary(root), browser, page, downloads, finishDownload, finishUnlock, holdUnlock = false;
const errors = [], checks = [], requests = [];
const collection = newCollection('private board', { mode: 'offline', motion: false });
const publicCollection = newCollection('public board');
const fixture = await startFixture({ video: true });
const videoBytes = Buffer.from(await (await fetch(`${fixture.url}/clip.mp4`)).arrayBuffer());
await fixture.close();
const folder = randomUUID(), itemId = randomUUID();
await mkdir(path.join(root, 'media', folder));
await writeFile(path.join(root, 'media', folder, 'clip.mp4'), videoBytes);
const pin = { id: randomUUID(), collectionId: collection.id, title: 'private movie', notes: 'private note', tags: ['private-tag'], offline: true, engine: 'page', sourceUrl: 'https://example.com/private', coverId: itemId, folder,
  items: [{ id: itemId, kind: 'video', localFile: `${folder}/clip.mp4`, previewFile: `${folder}/clip.mp4`, width: 1280, height: 960 }] };
await library.mutate(draft => {
  draft.collections.push(collection, publicCollection);
  draft.pins.push(pin, { id: randomUUID(), collectionId: publicCollection.id, title: 'public reference', sourceUrl: 'https://example.com/public', items: [{ id: randomUUID(), kind: 'text', text: 'A public reference to keep visible.' }] });
});
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (['/', '/app.js', '/styles.css'].includes(url.pathname)) {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      let body = await readFile(path.join('src/renderer', file), 'utf8');
      if (file === 'app.js') body = body.replaceAll('papan://media/', '/media/');
      response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }); response.end(body); return;
    }
    const [, , pinId, mediaId, kind] = url.pathname.split('/');
    const item = library.snapshot().pins.find(pin => pin.id === pinId)?.items.find(item => item.id === mediaId);
    if (!item) { response.writeHead(404); response.end(); return; }
    const descriptor = library.protection.media(item, kind === 'original') || mediaLocation(root, item, kind === 'original');
    const result = await fileResponse(descriptor, new Request(`http://localhost${request.url}`, { method: request.method, headers: request.headers }), 'video/mp4');
    requests.push({ encrypted: Boolean(item.vault), range: request.headers.range, status: result.status, cache: result.headers.get('cache-control') });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body) {
      const stream = Readable.fromWeb(result.body); response.on('close', () => stream.destroy()); stream.on('error', error => response.destroy(error)); stream.pipe(response);
    } else response.end();
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
try {
  browser = await chromium.launch({ executablePath: process.env.PAPAN_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--headless', '--ozone-platform=headless', '--enable-automation'], env });
  const cdp = await browser.newBrowserCDPSession(), { arguments: args } = await cdp.send('Browser.getBrowserCommandLine');
  assert.ok(args.some(arg => arg.startsWith('--headless'))); assert.equal(args.filter(arg => arg.startsWith('--ozone-platform=')).at(-1), '--ozone-platform=headless');
  page = await browser.newPage({ viewport: { width: 1200, height: 940 } }); page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  downloads = await openDownloadQueue(root, async () => new Promise((resolve, reject) => { finishDownload = success => { finishDownload = null; if (success) resolve({ collectionId: collection.id }); else reject(new Error('Fixture failed')); }; }), tasks => { page.evaluate(tasks => window.downloadListener?.(tasks), tasks).catch(error => errors.push(error.message)); }, {
    encode: (task, data) => library.protection.encodeTask(task, data || library.snapshot()), decode: (task, required) => library.protection.decodeTask(task, required),
  });
  await page.exposeFunction('callPapan', async (method, input) => {
    if (method === 'library') return library.publicSnapshot();
    if (method === 'downloads') return downloads.snapshot();
    if (method === 'tools') return {};
    if (['retryDownload', 'dismissDownload', 'cancelDownload'].includes(method)) return downloads[method.replace('Download', '')](input);
    if (['protectCollection', 'lockCollection', 'unlockCollection', 'closeCollection'].includes(method)) {
      if (downloads.snapshot().some(task => ['queued', 'running'].includes(task.state))) throw new Error('Wait for downloads to finish.');
      let restore;
      await library.mutate(draft => {
        if (method === 'protectCollection') return library.protection.setPassword(draft, input.id, input.password, input.currentPassword);
        if (method === 'unlockCollection') return library.protection.unlock(draft, input.id, input.password);
        const id = typeof input === 'string' ? input : input.id;
        if (method === 'closeCollection') draft.collections.find(c => c.id === id).closed = true;
        library.protection.lock(draft, id);
      }, () => restore?.(), async draft => { restore = await downloads.recode(draft); });
      downloads.publish();
      if (method === 'unlockCollection' && holdUnlock) { holdUnlock = false; await new Promise(resolve => { finishUnlock = resolve; }); finishUnlock = null; }
      return library.publicSnapshot();
    }
    if (method === 'openCollection') {
      // Model the encrypted file picker result for this existing collection.
      await library.mutate(draft => { library.protection.lock(draft, collection.id); draft.collections.find(c => c.id === collection.id).closed = false; });
      return library.publicSnapshot().collections.find(c => c.id === collection.id);
    }
    if (method === 'reopenCollection') { await library.mutate(draft => { draft.collections.find(c => c.id === input).closed = false; }); return library.publicSnapshot().collections.find(c => c.id === input); }
    if (method === 'updateCollection') { await library.mutate(draft => Object.assign(draft.collections.find(c => c.id === input.id), { name: input.name, settings: input.settings })); return library.publicSnapshot().collections.find(c => c.id === input.id); }
    throw new Error(`Unexpected API: ${method}`);
  });
  await page.addInitScript(() => {
    window.papan = Object.fromEntries(['library', 'downloads', 'tools', 'protectCollection', 'lockCollection', 'unlockCollection', 'closeCollection', 'reopenCollection', 'openCollection', 'updateCollection', 'retryDownload', 'dismissDownload', 'cancelDownload'].map(name => [name, input => window.callPapan(name, input)]));
    window.papan.onDownloads = listener => { window.downloadListener = listener; }; window.papan.onProgress = () => {};
  });
  await page.goto(url);
  await expect(page.locator('.pin')).toHaveCount(1); await expect(page.locator('#downloads-toggle')).toBeHidden();
  await page.locator('#collection-settings').click(); await page.getByRole('tab', { name: 'Privacy', exact: true }).click(); await page.locator('#manage-protection').click();
  await expect(page.locator('#password-dialog')).toBeVisible();
  await page.locator('#collection-password').fill('private test password'); await page.locator('#confirm-password').fill('a different password');
  await page.locator('#submit-password').click(); await expect(page.locator('#password-error')).toContainText('do not match');
  await page.locator('#confirm-password').fill('private test password'); await page.locator('#submit-password').click();
  await expect(page.locator('#password-dialog')).toBeHidden(); await expect(page.locator('#lock-collection')).toBeVisible();
  assert.equal(library.publicSnapshot().collections[0].protected, true);
  await page.locator('.tile-main').click();
  const video = page.locator('#viewer-media video');
  await expect.poll(() => video.evaluate(v => v.readyState >= 2 && v.seekable.length > 0)).toBe(true);
  await video.evaluate(v => v.pause());
  for (const time of [10, 2, 7]) {
    await video.evaluate((v, time) => { v.currentTime = time; }, time);
    await expect.poll(() => video.evaluate(v => !v.seeking && v.readyState >= 2)).toBe(true);
    assert.ok(Math.abs(await video.evaluate(v => v.currentTime) - time) < .1);
  }
  await page.locator('[data-close="viewer"]').click();
  assert.ok(requests.some(r => r.encrypted && r.status === 206 && r.cache === 'no-store'));
  checks.push('password confirmation and encryption; encrypted video loads and seeks forward/backward without plaintext playback files');
  const privateTab = page.locator(`#collection-tab-${collection.id}`), publicTab = page.locator(`#collection-tab-${publicCollection.id}`);
  const passwordDialog = page.locator('#password-dialog');
  await page.locator('#lock-collection').click(); await expect(publicTab).toHaveAttribute('aria-selected', 'true');
  await expect(passwordDialog).toBeHidden(); await expect(page.locator('.pin')).toContainText('public reference');
  await expect(page.locator('#start-collecting')).not.toHaveText('unlock this collection');
  assert.equal((await fetch(`${url}/media/${pin.id}/${itemId}/original`)).status, 404);
  assert.ok(!(await page.locator('body').textContent()).includes('private note'));
  await page.locator('#toggle-search').click(); await page.locator('#search-scope').selectOption('all'); await page.locator('#search').fill('private');
  await expect(page.locator('.pin')).toHaveCount(0);
  await page.locator('#search').fill('public'); await page.mouse.click(30, 180);
  await privateTab.click(); await expect(passwordDialog).toBeVisible(); await expect(page.locator('#collection-password')).toBeFocused();
  await expect(page.locator('#password-title')).toHaveText('unlock private board');
  await expect(publicTab).toHaveAttribute('aria-selected', 'true'); await expect(privateTab).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('.pin')).toContainText('public reference'); await expect(page.locator('#search')).toHaveValue('public');
  await page.locator('#collection-password').fill('incorrect password'); await page.locator('#submit-password').click();
  await expect(page.locator('#password-error')).toContainText('Incorrect password');
  await expect(publicTab).toHaveAttribute('aria-selected', 'true');
  await page.mouse.click(30, 180); await expect(passwordDialog).toBeHidden();
  await expect(page.locator('#collection-password')).toHaveValue('');
  await expect(page.locator('#search')).toHaveValue('public');
  await page.keyboard.press('Control+Tab'); await expect(passwordDialog).toBeVisible(); await page.keyboard.press('Escape');
  await expect(passwordDialog).toBeHidden(); await expect(publicTab).toHaveAttribute('aria-selected', 'true');
  await publicTab.focus(); await page.keyboard.press('ArrowLeft'); await expect(passwordDialog).toBeVisible();
  await page.locator('[data-close="password-dialog"]').click(); await expect(passwordDialog).toBeHidden();
  assert.equal(library.publicSnapshot().collections.find(c => c.id === collection.id).locked, true);
  await privateTab.click(); await page.locator('#collection-password').fill('private test password'); await page.locator('#submit-password').click();
  await expect(passwordDialog).toBeHidden(); await expect(privateTab).toHaveAttribute('aria-selected', 'true');
  await expect(privateTab).toBeFocused(); await expect(page.locator('.pin')).toContainText('private movie'); await expect(page.locator('#search')).toHaveValue('');
  checks.push('locked tab clicks and keyboard navigation prompt immediately; wrong passwords and dismissal preserve the current board and filters; successful unlock selects the target');
  checks.push('locking hides private pins, denies media and search, and returns to an unlocked board without an unlock landing screen');

  await page.locator(`[data-close-collection="${collection.id}"]`).click(); await expect(privateTab).toHaveCount(0);
  await page.locator('#open-collection').click(); await page.locator(`[data-reopen-collection="${collection.id}"]`).click();
  await expect(passwordDialog).toBeVisible(); await expect(publicTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape'); await expect(passwordDialog).toBeHidden();
  await expect(privateTab).toHaveAttribute('aria-selected', 'false');
  await page.locator(`[data-close-collection="${collection.id}"]`).click(); await expect(privateTab).toHaveCount(0);
  await page.locator('#open-collection').click(); await page.locator('#browse-collection').click();
  await expect(passwordDialog).toBeVisible(); await expect(publicTab).toHaveAttribute('aria-selected', 'true');
  holdUnlock = true;
  await page.locator('#collection-password').fill('private test password'); await page.locator('#submit-password').click();
  await expect.poll(() => typeof finishUnlock).toBe('function');
  await page.mouse.click(30, 180); await expect(passwordDialog).toBeHidden();
  finishUnlock();
  await expect.poll(() => library.publicSnapshot().collections.find(c => c.id === collection.id).locked).toBe(true);
  await expect(page.locator('#submit-password')).toBeEnabled();
  await expect(publicTab).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('.pin')).toContainText('public reference');
  await privateTab.click(); await page.locator('#collection-password').fill('private test password'); await page.locator('#submit-password').click();
  await expect(passwordDialog).toBeHidden(); await expect(privateTab).toHaveAttribute('aria-selected', 'true');
  checks.push('reopening closed collections and choosing encrypted files prompt immediately; dismissal during an unlock relocks the target without switching boards');

  await page.locator('#collection-settings').click(); await page.getByRole('tab', { name: 'Privacy', exact: true }).click(); await page.locator('#manage-protection').click();
  await page.locator('#current-password').fill('private test password'); await page.locator('#collection-password').fill('replacement password'); await page.locator('#confirm-password').fill('replacement password'); await page.locator('#submit-password').click();
  await expect(page.locator('#password-dialog')).toBeHidden();
  library.protection.clear(); library = await openLibrary(root); await page.reload();
  await expect(publicTab).toHaveAttribute('aria-selected', 'true'); await expect(passwordDialog).toBeHidden();
  await page.locator(`[data-close-collection="${publicCollection.id}"]`).click(); await expect(publicTab).toHaveCount(0);
  await expect(passwordDialog).toBeHidden(); await expect(privateTab).toHaveAttribute('tabindex', '0');
  await page.reload(); await expect(passwordDialog).toBeVisible(); await expect(page.locator('#collection-password')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(passwordDialog).toBeHidden();
  await expect(page.locator('.collection-tab[aria-selected="true"]')).toHaveCount(0);
  await expect(page.locator('#start-collecting')).toHaveText('paste link to start collecting');
  await privateTab.focus(); await page.keyboard.press('Enter'); await expect(passwordDialog).toBeVisible();
  await page.locator('#collection-password').fill('replacement password'); await page.locator('#submit-password').click();
  await expect(page.locator('.pin')).toHaveCount(1);
  checks.push('changed password survives restart; locked-only startup prompts immediately, dismissal leaves a neutral canvas and keyboard access can reopen the prompt');
  await page.locator('#collection-settings').click(); await page.getByRole('tab', { name: 'Privacy', exact: true }).click(); await page.locator('#remove-protection').click();
  await page.locator('#current-password').fill('replacement password'); await page.locator('#submit-password').click();
  await expect(page.locator('#password-dialog')).toBeHidden(); await expect(page.locator('#lock-collection')).toBeHidden();
  assert.equal(library.publicSnapshot().collections[0].protected, false);
  checks.push('remove password restores ordinary collection and saved media');
  await downloads.add('save', { pin: { ...pin, sourceUrl: 'https://example.com/queue-test' } }, 'download check');
  await expect(page.locator('#downloads-toggle')).toBeVisible();
  await page.locator('#downloads-toggle').click(); await expect(page.locator('.download')).toHaveCount(1);
  await expect.poll(() => typeof finishDownload).toBe('function'); finishDownload(true); await expect(page.locator('#downloads-toggle')).toBeHidden();
  await expect(page.locator('#downloads-panel')).toBeHidden(); await expect(page.locator('.download')).toHaveCount(0);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'downloads.json'))), []);
  await downloads.add('save', { pin: { ...pin, sourceUrl: 'https://example.com/failure-test' } }, 'failed download');
  await expect.poll(() => typeof finishDownload).toBe('function'); finishDownload(false);
  await expect(page.locator('#downloads-toggle')).toBeHidden();
  await page.locator('#open-collection').click(); await page.locator('#review-downloads').click();
  await expect(page.locator('.download')).toContainText('Fixture failed');
  await page.getByRole('button', { name: 'retry', exact: true }).click();
  await expect(page.locator('#downloads-toggle')).toBeVisible();
  await expect.poll(() => typeof finishDownload).toBe('function'); finishDownload(true);
  await expect(page.locator('#downloads-toggle')).toBeHidden(); await expect(page.locator('.download')).toHaveCount(0);
  checks.push('idle downloads button hidden; active queue visible; success removes history; failed work remains accessible and retryable');
  assert.deepEqual(errors, []);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/protection-check.json', JSON.stringify({ status: 'passed', display: 'isolated headless Chromium', checks, limits: 'Production renderer/library/crypto/queue; IPC stubbed and custom scheme mapped to loopback HTTP.' }, null, 2) + '\n');
  console.log(checks.join('\n'));
} catch (error) {
  console.error(await page?.evaluate(() => ({ passwordPopup: document.getElementById('password-dialog').open, passwordError: document.getElementById('password-error').textContent, selectedTab: document.querySelector('.collection-tab[aria-selected="true"]')?.textContent })));
  throw error;
} finally {
  finishUnlock?.(); downloads?.stop(); library.protection.clear(); if (browser) await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await rm(root, { recursive: true, force: true });
}
