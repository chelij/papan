import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newCollection } from '../src/library.js';

const data = await mkdtemp(path.join(os.tmpdir(), 'papan-browser-session-'));
const collection = newCollection('session checks'), errors = [], checks = [];
await mkdir(path.join(data, 'library'));
await writeFile(path.join(data, 'library/library.json'), JSON.stringify({ version: 1, collections: [collection], pins: [] }));
let app, page;
async function launch() {
  app = await electron.launch({ executablePath: process.env.PAPAN_EXECUTABLE, args: process.env.PAPAN_EXECUTABLE ? [] : [process.cwd()], env: { ...process.env, PAPAN_DATA_DIR: data, ELECTRON_RUN_AS_NODE: undefined } });
  page = await app.firstWindow();
  if (process.env.DISPLAY === ':97') {
    const id = await app.evaluate(({ BrowserWindow }) => '0x' + BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE().toString(16));
    assert.equal(spawnSync('xprop', ['-display', ':97', '-id', id, 'WM_CLASS']).status, 0, 'test window belongs to the isolated display');
  }
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('tab', { name: collection.name, exact: true })).toBeVisible();
}
try {
  await launch();
  assert.equal(await page.evaluate(() => window.papan.browserSession()), 'auto');
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Privacy', exact: true }).click();
  const toggle = page.getByRole('checkbox', { name: 'use browser sessions', exact: true });
  await expect(toggle).toBeEnabled(); await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(() => page.evaluate(() => window.papan.browserSession())).toBe('');
  const preferences = path.join(data, 'library/browser-session.json');
  assert.deepEqual(JSON.parse(await readFile(preferences, 'utf8')), { browser: '' });
  if (process.platform !== 'win32') assert.equal((await stat(preferences)).mode & 0o777, 0o600);
  assert.equal(await page.evaluate(async () => { try { await window.papan.setBrowserSession('/arbitrary/profile'); return false; } catch { return true; } }), true);
  await toggle.check();
  await expect.poll(() => page.evaluate(() => window.papan.browserSession())).toBe('auto');
  assert.deepEqual(JSON.parse(await readFile(preferences, 'utf8')), { browser: 'auto' });
  assert.equal(await page.locator('#settings-form').evaluate(form => form.scrollWidth > form.clientWidth), false);
  await mkdir('artifacts', { recursive: true });
  await page.locator('#settings-dialog').screenshot({ path: 'artifacts/browser-session-settings.png' });
  checks.push('automatic discovery is enabled by default; Privacy toggle persists only the mode with private file permissions; invalid paths are rejected');
  await page.getByRole('button', { name: 'Close collection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await app.close(); app = null; await launch();
  assert.equal(await page.evaluate(() => window.papan.browserSession()), 'auto');
  checks.push('automatic mode survives a real Electron restart');
  if (process.env.PAPAN_TEST_X_URL) {
    const result = await page.evaluate(url => window.papan.inspect({ url, requestId: crypto.randomUUID() }), process.env.PAPAN_TEST_X_URL);
    assert.ok(result.items.some(item => item.kind === 'video' || item.kind === 'image'));
    checks.push('the supplied login-required X post is inspected through real IPC using automatic browser discovery');
    const media = result.items.find(item => item.kind === 'video' || item.kind === 'image');
    const task = await page.evaluate(input => window.papan.enqueueSave(input), { inspectionId: result.id, selectedIds: [media.id], coverId: media.id, title: 'authenticated save check', collectionId: collection.id, tags: [], notes: '' });
    console.log('Automatic discovery found the post; checking its queued save.');
    await expect.poll(async () => {
      const failed = await page.evaluate(id => window.papan.downloads().then(tasks => tasks.find(task => task.id === id && task.state === 'failed')), task);
      if (failed) throw new Error(failed.error);
      return page.evaluate(() => window.papan.library().then(library => library.pins.length));
    }, { timeout: 180000, intervals: [250, 1000, 2000] }).toBe(1);
    const pin = await page.evaluate(() => window.papan.library().then(library => library.pins[0]));
    assert.equal(pin.items[0].kind, media.kind); assert.ok(pin.items[0].previewFile);
    checks.push('the queued authenticated download commits an actual saved preview using the discovered session');
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/browser-session-check.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} finally { if (app) await app.close(); await rm(data, { recursive: true, force: true }); }
