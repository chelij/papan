import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startFixture } from '../test/fixture.js';

const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'papan-collections-')));
const data = path.join(directory, 'profile'), secondData = path.join(directory, 'second-profile');
const destination = path.join(directory, 'lists');
await mkdir(destination);
const file = path.join(destination, 'references.papan');
const fixture = await startFixture({ video: true });
let app, page, fixtureClosed = false;
const errors = [];
async function launch(profile = data) {
  app = await electron.launch({ executablePath: process.env.PAPAN_EXECUTABLE, args: process.env.PAPAN_EXECUTABLE ? [] : [process.cwd()], env: { ...process.env, PAPAN_DATA_DIR: profile, ELECTRON_RUN_AS_NODE: undefined } });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
  await page.waitForFunction(() => Boolean(window.papan));
  await app.evaluate(({ dialog }) => {
    globalThis.papanChoices = []; globalThis.papanDialogs = [];
    dialog.showSaveDialog = async (_window, options) => { globalThis.papanDialogs.push({ kind: 'save', options }); return globalThis.papanChoices.shift() || { canceled: true }; };
    dialog.showOpenDialog = async (_window, options) => { globalThis.papanDialogs.push({ kind: 'open', options }); return globalThis.papanChoices.shift() || { canceled: true, filePaths: [] }; };
  });
}
const choose = value => app.evaluate((_electron, value) => globalThis.papanChoices.push(value), value);
const snapshot = () => page.evaluate(() => window.papan.library());
const manifest = async () => JSON.parse(await readFile(file, 'utf8'));
async function browse(savedFile) {
  await choose({ canceled: false, filePaths: [savedFile] });
  await page.getByRole('button', { name: 'browse for a collection…', exact: true }).click();
}
try {
  await mkdir('artifacts', { recursive: true });
  await launch();
  await expect(page.getByRole('button', { name: 'open a collection', exact: true })).toBeVisible();
  const created = await page.evaluate(async base => {
    const collection = await window.papan.createCollection({ name: 'references', settings: { mode: 'offline' } });
    for (const route of ['/mixed', '/article']) {
      const found = await window.papan.inspect({ requestId: crypto.randomUUID(), url: base + route });
      await window.papan.save({ requestId: crypto.randomUUID(), inspectionId: found.id, selectedIds: found.items.map(item => item.id), coverId: found.items[0].id, collectionId: collection.id });
    }
    return collection;
  }, fixture.url);
  await page.reload();
  await expect(page.locator('.pin')).toHaveCount(2);
  const original = await snapshot();
  const filesBefore = await readdir(path.join(data, 'library/media'), { recursive: true });
  // Cancelling the native picker leaves the collection unchanged.
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save collection', exact: true })).toBeEnabled();
  assert.equal((await snapshot()).collections[0].destination, undefined);
  await choose({ canceled: false, filePath: file });
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await expect.poll(async () => (await snapshot()).collections[0].destination).toBe(file);
  const saved = await manifest();
  assert.deepEqual(await readdir(destination), ['references.papan']);
  assert.equal(saved.pins.length, 2);
  for (const [index, pin] of original.pins.entries()) for (const [itemIndex, item] of pin.items.entries()) {
    if (item.kind === 'text') continue;
    assert.equal(saved.pins[index].items[itemIndex].previewPath, path.join(data, 'library/media', item.previewFile));
    assert.equal(saved.pins[index].items[itemIndex].localPath, path.join(data, 'library/media', item.localFile));
  }
  assert.deepEqual(await readdir(path.join(data, 'library/media'), { recursive: true }), filesBefore);
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await expect(page.locator('#collection-destination')).toHaveText(file);
  await page.getByLabel('name', { exact: true }).fill('saved references');
  await page.getByRole('slider', { name: 'layout density', exact: true }).press('End');
  await page.getByRole('button', { name: 'save settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  assert.equal((await manifest()).collection.name, 'saved references');
  assert.equal((await manifest()).collection.settings.density, 10);
  assert.equal(JSON.parse(await readFile(path.join(destination, 'references.previous.papan'))).collection.name, 'references');
  const pins = (await snapshot()).pins;
  await page.locator('.tile-main').first().press('Alt+ArrowRight');
  await expect.poll(async () => (await manifest()).pins.map(pin => pin.id)).toEqual([pins[1].id, pins[0].id]);

  await page.getByRole('button', { name: 'Close saved references', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  assert.equal((await snapshot()).pins.length, 2);
  await app.close(); app = null;
  await launch();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open collection', exact: true }).click();
  await page.locator('[data-reopen-collection]').click();
  await expect(page.getByRole('tab', { name: 'saved references', exact: true })).toBeVisible();
  await expect(page.locator('.pin')).toHaveCount(2);
  assert.equal((await snapshot()).collections[0].settings.density, 10);

  // An unavailable destination cannot silently lose or partially commit edits.
  const moved = path.join(directory, 'unplugged');
  await rename(destination, moved);
  const beforeFailure = await snapshot();
  const failure = await page.evaluate(async collection => {
    try { await window.papan.updateCollection({ id: collection.id, name: 'must not commit', settings: collection.settings, requestId: crypto.randomUUID() }); return ''; }
    catch (error) { return error.message; }
  }, beforeFailure.collections[0]);
  assert.match(failure, /unavailable/);
  assert.deepEqual(await snapshot(), beforeFailure);
  await page.getByRole('button', { name: 'Close saved references', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open collection', exact: true }).click();
  await page.locator('[data-reopen-collection]').click();
  await expect(page.getByRole('tab', { name: 'saved references', exact: true })).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Opened the local copy');
  assert.deepEqual(await snapshot(), beforeFailure);
  await rename(moved, destination);
  const external = await manifest(); external.revision = crypto.randomUUID(); external.collection.name = 'changed outside Papan';
  await writeFile(file, JSON.stringify(external));
  const stale = await page.evaluate(async id => { try { await window.papan.saveCollection({ id }); return ''; } catch (error) { return error.message; } }, created.id);
  assert.match(stale, /newer collection/);
  assert.equal((await manifest()).collection.name, 'changed outside Papan');
  await page.getByRole('button', { name: 'Open collection', exact: true }).click();
  await browse(file);
  await expect(page.getByRole('tab', { name: 'changed outside Papan', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(1);

  // Removing the app's entry must keep media used by a saved list, even after the next snapshot/restart.
  await page.evaluate(async () => {
    const library = await window.papan.library();
    await window.papan.deleteCollection(library.collections[0].id);
    await window.papan.createCollection({ name: 'another collection' });
  });
  await app.close(); app = null;
  await launch();
  for (const pin of saved.pins) for (const item of pin.items) for (const field of ['previewPath', 'localPath']) if (item[field]) assert.ok((await stat(item[field])).isFile());
  await app.close(); app = null;
  await fixture.close(); fixtureClosed = true;

  // A fresh profile reopens the list and plays the original files with no media imports or network.
  await launch(secondData);
  await page.getByRole('button', { name: 'open a collection', exact: true }).click();
  await browse(file);
  await expect(page.locator('.pin')).toHaveCount(2);
  assert.deepEqual(await readdir(path.join(secondData, 'library/media')), []);
  await page.getByRole('button', { name: 'Details for A full video, then an image', exact: true }).click();
  await page.waitForFunction(() => { const video = document.querySelector('#viewer-media video'); return video?.videoWidth === 1280 && video.currentTime > .1 && !video.paused; });
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#viewer-media img')?.naturalWidth > 0);
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await page.getByRole('button', { name: 'Details for A place for curiosity', exact: true }).click();
  await expect(page.locator('.article-body')).toContainText('A quiet place');
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await page.getByRole('button', { name: 'Close changed outside Papan', exact: true }).click();
  await page.getByRole('button', { name: 'Open collection', exact: true }).click();
  await page.screenshot({ path: 'artifacts/open-collections.png' });
  await page.locator('[data-reopen-collection]').click();
  await page.getByRole('button', { name: 'Collection settings', exact: true }).click();
  await page.screenshot({ path: 'artifacts/collection-destination.png' });
  assert.deepEqual(errors, []);
  await writeFile('artifacts/collections-check.json', JSON.stringify({ date: new Date().toISOString(), status: 'passed', packaged: Boolean(process.env.PAPAN_EXECUTABLE), mediaCopied: false }, null, 2));
  console.log('Collection files passed: destination picker/cancel, list-only saves, automatic updates/backups, pin order, close/reopen/restart, conflict/failure protection, retained media, and offline playback from another profile without copying media.');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: 'artifacts/collections-failure.png', fullPage: true });
  throw error;
} finally {
  if (app) await app.close();
  if (!fixtureClosed) await fixture.close();
  await rm(directory, { recursive: true, force: true });
}
