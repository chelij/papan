import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startFixture } from '../test/fixture.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'papan-organization-'));
const data = path.join(directory, 'profile'), fresh = path.join(directory, 'fresh');
const fixture = await startFixture();
let hold = true, waiting;
const slow = createServer((request, response) => {
  if (request.url === '/post') { response.setHeader('Content-Type', 'text/html'); response.end('<html><title>A slow image</title><body><img src="/slow.svg"></body></html>'); }
  else if (hold) waiting = response;
  else { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="blue"/></svg>'); }
});
await new Promise(resolve => slow.listen(0, '127.0.0.1', resolve));
const slowURL = `http://127.0.0.1:${slow.address().port}/post`;
let app, page, stopped = false;
const errors = [];
async function launch(profile) {
  app = await electron.launch({ executablePath: process.env.PAPAN_EXECUTABLE, args: process.env.PAPAN_EXECUTABLE ? [] : [process.cwd()],
    env: { ...process.env, PAPAN_DATA_DIR: profile, PAPAN_PYTHON_WORKER: process.env.PAPAN_EXECUTABLE ? '' : '1', ELECTRON_RUN_AS_NODE: undefined } });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('#start-collecting')).toBeVisible();
  await app.evaluate(({ dialog }) => {
    globalThis.savePaths = []; globalThis.openPaths = [];
    dialog.showSaveDialog = async () => { const filePath = globalThis.savePaths.shift(); return { canceled: !filePath, filePath }; };
    dialog.showOpenDialog = async () => { const file = globalThis.openPaths.shift(); return { canceled: !file, filePaths: file ? [file] : [] }; };
  });
}
const library = () => page.evaluate(() => window.papan.library());
const waitDownloads = () => expect.poll(() => page.evaluate(() => window.papan.downloads().then(tasks => tasks.filter(task => ['queued', 'running'].includes(task.state)).length)), { timeout: 30000 }).toBe(0);
try {
  await mkdir('artifacts', { recursive: true });
  await launch(data);
  // A paste directly on the canvas is the primary onboarding path.
  await page.evaluate(url => { const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', url); document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData })); }, `${fixture.url}/album`);
  await expect(page.locator('#inspection')).toBeVisible();
  await page.getByRole('button', { name: 'add to collection' }).click();
  await expect(page.locator('#add-dialog')).toBeHidden();
  await waitDownloads();
  await expect(page.locator('.pin')).toHaveCount(1);
  const first = (await library()).pins[0];
  const sourceId = first.collectionId;
  await page.getByLabel('Details for Collected colors', { exact: true }).click();
  await page.getByRole('button', { name: 'edit pin', exact: true }).click();
  await page.locator('#edit-collection').selectOption('');
  await page.getByLabel('name', { exact: true }).fill('design notes');
  await page.getByRole('button', { name: 'create collection', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  const targetId = (await library()).collections.find(item => item.name === 'design notes').id;
  await page.getByLabel('pin title', { exact: true }).fill('Color studies');
  await page.locator('#edit-tags').fill('color, inspiration');
  await page.locator('#edit-notes').fill('Warm shapes for the next poster');
  await page.locator('#edit-collection').selectOption(targetId);
  await page.getByLabel('Cover item 2', { exact: true }).check();
  await page.screenshot({ path: 'artifacts/edit-pin.png' });
  await page.getByRole('button', { name: 'save pin', exact: true }).click();
  await expect(page.locator('#pin-editor')).toBeHidden();
  const edited = (await library()).pins.find(pin => pin.id === first.id);
  assert.equal(edited.collectionId, targetId); assert.equal(edited.title, 'Color studies');
  assert.equal(edited.coverId, first.items[1].id); assert.equal(edited.notes, 'Warm shapes for the next poster');
  assert.deepEqual(edited.tags, ['color', 'inspiration']);

  // Global search includes a closed collection, notes, tags and source/type filters.
  await page.getByLabel('Close design notes', { exact: true }).click();
  await page.getByRole('button', { name: 'Search collection', exact: true }).click();
  await page.getByLabel('search in', { exact: true }).selectOption('all');
  await page.locator('#search').fill('poster');
  await page.getByLabel('media type', { exact: true }).selectOption('image');
  await page.getByLabel('tag', { exact: true }).selectOption('color');
  await page.getByLabel('source', { exact: true }).selectOption('127.0.0.1');
  await expect(page.locator('.pin')).toHaveCount(1);
  assert.equal(await page.locator('.pin').getAttribute('draggable'), 'false');
  await expect(page.locator('.tile-collection')).toHaveText('design notes');
  await page.screenshot({ path: 'artifacts/global-search.png' });
  await page.locator('#search').press('Escape');
  await page.getByLabel('Details for Color studies', { exact: true }).click();
  await expect(page.locator('#viewer-details')).toContainText('Warm shapes');
  await page.getByRole('button', { name: 'remove pin', exact: true }).click();
  await page.getByRole('button', { name: 'remove', exact: true }).click();
  await page.getByRole('button', { name: 'undo', exact: true }).click();
  await expect(page.locator('.pin')).toHaveCount(1);
  assert.deepEqual((await library()).pins[0], edited);

  // Both saved lists remain unchanged when a move encounters a stale destination.
  const sourceFile = path.join(directory, 'source.papan'), targetFile = path.join(directory, 'target.papan');
  await app.evaluate((_electron, files) => { globalThis.savePaths.push(...files); }, [sourceFile, targetFile]);
  await page.evaluate(async ids => { await window.papan.saveCollection({ id: ids[0] }); await window.papan.saveCollection({ id: ids[1] }); }, [targetId, sourceId]);
  const sourceBefore = await readFile(sourceFile, 'utf8'), targetBefore = await readFile(targetFile, 'utf8');
  const conflict = JSON.parse(targetBefore); conflict.revision = randomUUID();
  await writeFile(targetFile, JSON.stringify(conflict));
  await page.evaluate(ids => window.papan.reorder({ kind: 'collection', id: ids[0], beforeId: ids[1] }), [targetId, sourceId]);
  const modelBefore = await library();
  const error = await page.evaluate(input => window.papan.updatePin(input).then(() => '', error => error.message), { ...edited, id: edited.id, collectionId: sourceId, requestId: randomUUID() });
  assert.match(error, /newer collection/);
  assert.equal(await readFile(sourceFile, 'utf8'), sourceBefore);
  assert.equal(await readFile(targetFile, 'utf8'), JSON.stringify(conflict));
  assert.deepEqual(await library(), modelBefore);
  await writeFile(targetFile, targetBefore);

  // A blocked media download does not hold the library write lock; cancellation and retry are visible.
  const taskId = await page.evaluate(async ({ url, collectionId }) => {
    const inspection = await window.papan.inspect({ url, requestId: crypto.randomUUID() });
    return (await window.papan.enqueueSave({ inspectionId: inspection.id, selectedIds: inspection.items.map(item => item.id), collectionId })).taskId;
  }, { url: slowURL, collectionId: sourceId });
  await expect.poll(() => Boolean(waiting)).toBe(true);
  const start = Date.now();
  const spare = await page.evaluate(() => window.papan.createCollection({ name: 'while downloading' }));
  assert.ok(Date.now() - start < 3000, 'metadata edits should not wait for a download');
  assert.ok(spare.id);
  await page.getByLabel('Activity', { exact: true }).click();
  await expect(page.locator('.download[data-state="running"]')).toBeVisible();
  await page.screenshot({ path: 'artifacts/download-queue.png' });
  await page.locator(`[data-task="${taskId}"][data-action="cancelDownload"]`).click();
  await waitDownloads();
  await expect(page.locator(`[data-task="${taskId}"][data-action="retryDownload"]`)).toBeVisible();
  hold = false; waiting?.destroy();
  await page.locator(`[data-task="${taskId}"][data-action="retryDownload"]`).click();
  await waitDownloads();
  assert.equal((await page.evaluate(() => window.papan.downloads())).some(task => task.id === taskId), false);
  await expect(page.getByLabel('Activity', { exact: true })).toBeHidden();

  // A move to an offline collection downloads originals before it commits.
  await page.getByRole('tab', { name: 'design notes', exact: true }).click();
  await page.getByLabel('Details for Color studies', { exact: true }).click();
  await page.getByRole('button', { name: 'edit pin', exact: true }).click();
  await page.locator('#edit-collection').selectOption('');
  await page.getByLabel('name', { exact: true }).fill('offline poster');
  await page.getByRole('tab', { name: 'Storage', exact: true }).click();
  await page.getByLabel('media storage', { exact: true }).selectOption('offline');
  await page.getByRole('button', { name: 'create collection', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  const offlineId = (await library()).collections.find(item => item.name === 'offline poster').id;
  await page.locator('#edit-collection').selectOption(offlineId);
  await page.getByRole('button', { name: 'save pin', exact: true }).click();
  await expect(page.locator('#pin-editor')).toBeHidden();
  await waitDownloads();
  assert.ok((await library()).pins.find(pin => pin.id === first.id).offline);
  await page.getByRole('tab', { name: 'offline poster', exact: true }).click();
  const bundle = path.join(directory, 'poster.papan.zip');
  await app.evaluate((_electron, file) => { globalThis.savePaths.push(file); }, bundle);
  await page.getByLabel('Collection settings', { exact: true }).click();
  await page.getByRole('tab', { name: 'Storage', exact: true }).click();
  await page.getByRole('button', { name: 'export portable copy…', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('portable copy exported', { timeout: 30000 });
  assert.ok((await readFile(bundle)).length > 100);
  await app.close(); app = null;
  await fixture.close(); stopped = true;
  await rm(path.join(data, 'library', 'media'), { recursive: true });
  await launch(fresh);
  await app.evaluate((_electron, file) => { globalThis.openPaths.push(file); }, bundle);
  await page.getByRole('button', { name: 'open a collection', exact: true }).click();
  await page.getByRole('button', { name: 'browse for a collection…', exact: true }).click();
  await expect(page.locator('.pin')).toHaveCount(1, { timeout: 30000 });
  await page.getByRole('button', { name: 'Color studies', exact: true }).click();
  await expect(page.locator('#viewer')).toBeVisible();
  await expect.poll(() => page.locator('#viewer-media img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  assert.equal((await library()).pins[0].notes, edited.notes);
  await expect(page.locator('#viewer-details')).toContainText('inspiration');
  await page.screenshot({ path: 'artifacts/portable-import.png' });
  await page.getByRole('button', { name: 'remove pin', exact: true }).click();
  await page.getByRole('button', { name: 'remove', exact: true }).click();
  await expect(page.locator('.pin')).toHaveCount(0);
  await app.close(); app = null;
  await launch(fresh);
  await page.getByLabel('Open collection', { exact: true }).click();
  await page.locator('#trash-section summary').click();
  await page.locator('[data-restore]').click();
  await expect(page.locator('.pin')).toHaveCount(1);
  await page.getByRole('button', { name: 'Color studies', exact: true }).click();
  await expect.poll(() => page.locator('#viewer-media img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  assert.equal((await library()).pins[0].notes, edited.notes);
  assert.deepEqual(errors, []);
  console.log('Organization checks passed: canvas paste, edit/cover/tags/notes, moves, undo, global filters with closed collections, rollback of stale moves, responsive background queue, cancellation/retry, and portable offline import after source deletion.');
} finally {
  await app?.close(); waiting?.destroy(); slow.closeAllConnections();
  await new Promise(resolve => slow.close(resolve));
  if (!stopped) await fixture.close();
  await rm(directory, { recursive: true, force: true });
}
