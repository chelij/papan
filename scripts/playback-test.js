import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { newCollection } from '../src/library.js';
import { fileResponse } from '../src/file-response.js';
import { startFixture } from '../test/fixture.js';

// Exercise the real renderer and file response over loopback HTTP. Chromium
// cannot register Electron's custom scheme; the preload boundary is stubbed.
const data = await mkdtemp(path.join(os.tmpdir(), 'papan-playback-'));
const fixture = await startFixture({ video: true });
const media = Buffer.from(await (await fetch(`${fixture.url}/clip.mp4`)).arrayBuffer());
await writeFile(path.join(data, 'original.mp4'), media);
await fixture.close(); // Playback below uses only the saved local file.
const requests = [], errors = [], checks = [];
const server = http.createServer(async (request, response) => {
  const result = await fileResponse(path.join(data, 'original.mp4'), new Request(`http://localhost${request.url}`, { method: request.method, headers: request.headers }), 'video/mp4');
  requests.push({ range: request.headers.range, status: result.status, contentRange: result.headers.get('content-range') });
  response.writeHead(result.status, Object.fromEntries(result.headers));
  if (result.body) {
    const stream = Readable.fromWeb(result.body);
    response.on('close', () => stream.destroy());
    stream.on('error', error => response.destroy(error));
    stream.pipe(response);
  } else response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const collection = newCollection('playback check', { mode: 'offline', motion: false }), itemId = randomUUID();
const state = { collections: [collection], pins: [{ id: randomUUID(), collectionId: collection.id, title: 'Seekable saved video', sourceUrl: `${fixture.url}/video`, offline: true, coverId: itemId, items: [{ id: itemId, kind: 'video', url: `${url}/original` }] }] };
const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
let browser;
try {
  for (const kind of ['original', 'preview']) {
    const response = await fetch(`${url}/${kind}`, { headers: { Range: 'bytes=100-199' } });
    assert.equal(response.status, 206, `${kind} range response`);
    assert.equal(response.headers.get('content-range'), `bytes 100-199/${media.length}`);
    assert.equal(response.headers.get('content-length'), '100');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), media.subarray(100, 200));
  }
  checks.push('range responses have correct status, length and contents');
  browser = await chromium.launch({ executablePath: process.env.PAPAN_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--headless', '--ozone-platform=headless', '--enable-automation'], env });
  const browserCDP = await browser.newBrowserCDPSession();
  const { arguments: args } = await browserCDP.send('Browser.getBrowserCommandLine');
  assert.ok(args.some(arg => arg.startsWith('--headless')));
  assert.equal(args.filter(arg => arg.startsWith('--ozone-platform=')).at(-1), '--ozone-platform=headless');
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(state => { window.papan = { library: async () => state, downloads: async () => [], onDownloads() {}, onProgress() {}, tools: async () => ({}) }; }, state);
  await page.goto(pathToFileURL(path.resolve('src/renderer/index.html')).href);
  await expect(page.locator('.pin')).toHaveCount(1);
  await page.locator('.tile-main').click();
  const video = page.locator('#viewer-media video');
  await expect.poll(() => video.evaluate(v => v.readyState >= 2 && v.seekable.length > 0), { timeout: 10000 }).toBe(true);
  assert.equal(await video.evaluate(v => v.duration), 12);
  await video.evaluate(v => v.pause());
  for (const time of [10, 2, 7]) {
    await video.evaluate((v, time) => { v.currentTime = time; }, time);
    await expect.poll(() => video.evaluate(v => !v.seeking && v.readyState >= 2)).toBe(true);
    assert.ok(Math.abs(await video.evaluate(v => v.currentTime) - time) < .1);
  }
  checks.push('saved MP4 with end-of-file metadata loads and seeks forward/backward');
  await video.hover();
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const descendants = node => [node, ...[...(node.children || []), ...(node.shadowRoots || [])].flatMap(descendants)];
  const timeline = descendants(descendants(root).find(node => node.attributes?.includes('viewer-media'))).find(node => node.attributes?.includes('-webkit-media-controls-timeline'));
  assert.ok(timeline, 'native video timeline exists');
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId: timeline.nodeId });
  const [left, top, right, , , bottom] = model.content;
  for (const fraction of [.25, .8]) {
    await page.mouse.click(left + (right - left) * fraction, (top + bottom) / 2);
    await expect.poll(() => video.evaluate(v => v.currentTime)).toBeCloseTo(12 * fraction, 0);
    await expect.poll(() => video.evaluate(v => !v.seeking && v.readyState >= 2)).toBe(true);
  }
  const before = await video.evaluate(v => v.currentTime);
  await video.evaluate(v => v.play());
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThan(before + .3);
  checks.push('clicking the native timeline changes time in both directions and playback resumes');
  assert.deepEqual(errors, []);
  assert.ok(requests.some(request => request.range && request.status === 206));
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/playback-check.json', JSON.stringify({ status: 'passed', display: 'isolated headless Chromium', checks, requests, limits: 'Actual renderer and file response over HTTP; preload stubbed and Electron custom protocol registration not exercised by this test.' }, null, 2) + '\n');
  console.log(checks.join('\n'));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await rm(data, { recursive: true, force: true });
}
