import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { openLibrary, newCollection } from '../src/library.js';

const x11 = process.platform === 'linux';
if (x11) assert.ok(process.env.DISPLAY, 'Run this check on an isolated X display.');
const profile = await mkdtemp(path.join(os.tmpdir(), 'papan-app-connections-'));
const root = path.join(profile, 'library');
const errors = [], checks = [], env = { ...process.env, PAPAN_DATA_DIR: profile, ELECTRON_RUN_AS_NODE: undefined };
delete env.WAYLAND_DISPLAY;
let app, page, blocker;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64');
const shared = newCollection('Shared studies'), privateCollection = newCollection('Private references');
const password = 'a private test password';
async function launch() {
  app = await electron.launch({ executablePath: process.env.PAPAN_EXECUTABLE, args: [...(process.env.PAPAN_EXECUTABLE ? [] : [process.cwd()]), ...(x11 ? ['--ozone-platform=x11'] : [])], env });
  page = await app.firstWindow(); page.setDefaultTimeout(5000);
  if (x11) {
    assert.equal(await app.evaluate(() => process.env.DISPLAY), process.env.DISPLAY);
    assert.equal(await app.evaluate(({ app }) => app.commandLine.getSwitchValue('ozone-platform')), 'x11');
    const id = await app.evaluate(({ BrowserWindow }) => '0x' + BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE().toString(16));
    assert.equal(spawnSync('xprop', ['-display', process.env.DISPLAY, '-id', id, 'WM_CLASS']).status, 0, 'verify the window belongs to the isolated display before interacting');
  }
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.papan));
}
const request = (connection, route, options = {}) => fetch(connection.endpoint + route, { ...options, headers: { Authorization: 'Bearer ' + connection.token, ...options.headers } });
try {
  await launch();
  await page.locator('#connect-empty-apps').click();
  await expect(page.locator('#apps-dialog')).toBeVisible();
  await expect(page.locator('#apps-collections')).toContainText('Create or open a collection');
  await expect(page.locator('#apps-grant')).toBeDisabled();
  await page.keyboard.press('Escape'); await app.close(); app = null;
  checks.push('empty library exposes connections without granting empty access');

  const library = await openLibrary(root), pins = [];
  for (const collection of [shared, privateCollection]) {
    const folder = randomUUID(), id = randomUUID(), localFile = folder + '/original.png';
    await mkdir(path.join(root, 'media', folder)); await writeFile(path.join(root, 'media', localFile), png);
    pins.push({ id: randomUUID(), collectionId: collection.id, title: collection.id === shared.id ? 'Shared image' : 'Private secret image',
      sourceUrl: 'https://example.com/' + collection.id, offline: true, engine: 'page', folder, coverId: id,
      notes: 'saved reference', tags: ['two words', '日本語'], items: [{ id, kind: 'image', width: 1, height: 1, localFile, previewFile: localFile }] });
  }
  await library.mutate(draft => { draft.collections.push(shared, privateCollection); draft.pins.push(...pins); });
  await library.mutate(draft => library.protection.setPassword(draft, privateCollection.id, password));
  await library.mutate(draft => library.protection.lock(draft, privateCollection.id)); library.protection.clear();

  await launch(); await page.locator('#connect-apps').click();
  await expect(page.locator('#apps-collections input[value="' + privateCollection.id + '"]')).toBeDisabled();
  blocker = createServer(); await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  await page.locator('#apps-enabled').check(); await page.locator('#apps-port').fill(String(blocker.address().port));
  await page.locator('#apps-save').click(); await expect(page.locator('#apps-error')).toContainText('already in use');
  await new Promise(resolve => blocker.close(resolve));
  await page.locator('#apps-save').click(); await expect(page.locator('#apps-status')).toContainText('http://127.0.0.1:');
  await expect(page.locator('#apps-error')).toBeEmpty();
  await page.locator('#apps-name').fill('Example creative app');
  await page.locator('#apps-grant').click(); await expect(page.locator('#apps-connection')).toBeVisible();
  const connection = { endpoint: await page.locator('#apps-endpoint').inputValue(), token: await page.locator('#apps-key').inputValue() };
  assert.match(connection.token, /^[A-Za-z0-9_-]{43}$/);
  await page.locator('#apps-copy').click(); await expect(page.locator('#apps-copy-status')).toHaveText('connection copied');
  const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.deepEqual(JSON.parse(clipboard), { version: 1, ...connection });
  const result = await (await request(connection, '/v1/pins')).json();
  assert.deepEqual(result.items.map(pin => pin.title), ['Shared image']);
  assert.deepEqual(Buffer.from(await (await request(connection, new URL(result.items[0].items[0].originalUrl).pathname)).arrayBuffer()), png);
  await page.keyboard.press('Escape'); await expect(page.locator('#apps-key')).toHaveValue('');
  await page.locator('#connect-apps').click(); await expect(page.locator('#apps-connection')).toBeHidden();
  checks.push('actual Electron UI, preload, IPC, port collision recovery, selected grants, one-time key, clipboard and HTTP image bytes');

  await page.getByRole('button', { name: 'Change access for Example creative app' }).click();
  await page.locator('#apps-collections input:enabled').uncheck();
  await page.locator('#apps-grant').click(); await expect(page.locator('#apps-error')).toContainText('Choose at least one');
  await page.locator('#apps-cancel-edit').click();
  await page.evaluate(async ({ id, password }) => { await window.papan.unlockCollection({ id, password }); await refresh(); }, { id: privateCollection.id, password });
  await page.getByRole('button', { name: 'Change access for Example creative app' }).click();
  await page.locator('#apps-collections input[value="' + shared.id + '"]').uncheck();
  await page.locator('#apps-collections input[value="' + privateCollection.id + '"]').check();
  await page.locator('#apps-grant').click(); await expect(page.locator('#apps-clients')).toContainText('Private references');
  assert.deepEqual((await (await request(connection, '/v1/pins')).json()).items.map(pin => pin.title), ['Private secret image']);
  const privateRoute = `/v1/pins/${pins[1].id}/items/${pins[1].items[0].id}/media`;
  assert.deepEqual(Buffer.from(await (await request(connection, privateRoute, { headers: { Range: 'bytes=3-12' } })).arrayBuffer()), png.subarray(3, 13));
  await page.evaluate(async id => { await window.papan.lockCollection({ id }); await refresh(); }, privateCollection.id);
  assert.equal((await (await request(connection, '/v1/search')).json()).total, 0);
  assert.equal((await request(connection, privateRoute)).status, 404);
  checks.push('scope editing, empty-selection error, native unlock/lock, decrypted range bytes and hidden locked search/media');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(560, 400));
  const bounds = await page.locator('#apps-dialog').evaluate(dialog => ({ width: dialog.clientWidth, scrollWidth: dialog.scrollWidth, height: dialog.getBoundingClientRect().height, viewport: innerHeight }));
  assert.equal(bounds.scrollWidth, bounds.width); assert.ok(bounds.height <= bounds.viewport);
  await page.getByRole('button', { name: 'Change access for Example creative app' }).click();
  await expect(page.locator('#apps-name')).toBeFocused();
  await page.locator('#apps-cancel-edit').click();
  await page.locator('[data-close="apps-dialog"]').click(); await expect(page.locator('#connect-apps')).toBeFocused();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 850));
  await page.locator('#connect-apps').click();
  await mkdir('artifacts', { recursive: true }); await page.locator('#apps-dialog').screenshot({ path: 'artifacts/app-connections.png' });
  checks.push('short-window scrolling, no horizontal overflow, keyboard focus and dialog dismissal');
  await app.close(); app = null;

  await launch();
  assert.equal((await (await request(connection, '/v1/pins')).json()).total, 0);
  await page.locator('#connect-apps').click(); await expect(page.locator('#apps-clients')).toContainText('Example creative app');
  await page.getByRole('button', { name: 'Revoke Example creative app' }).click();
  await expect(page.locator('#apps-clients')).toContainText('no apps have access');
  assert.equal((await request(connection, '/v1/pins')).status, 401);
  await page.locator('#apps-enabled').uncheck(); await page.locator('#apps-save').click();
  await expect(page.locator('#apps-status')).toContainText('connections are off');
  await assert.rejects(request(connection, '/v1/pins'));
  assert.equal((await readFile(path.join(root, 'library-service.json'), 'utf8')).includes(connection.token), false);
  assert.deepEqual(errors, []);
  checks.push('restart retains grants with protected collections locked, revocation rejects the saved key, disable closes the listener');
  await writeFile('artifacts/app-connections-check.json', JSON.stringify({ status: 'passed', display: x11 ? process.env.DISPLAY : 'native CI desktop', checks }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', checks }, null, 2));
} finally { await app?.close(); blocker?.close(); await rm(profile, { recursive: true, force: true }); }
