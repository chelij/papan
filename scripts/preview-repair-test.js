import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import developmentFFmpeg from 'ffmpeg-static';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { openLibrary, newCollection } from '../src/library.js';
import { inspectLink, materialize } from '../src/media.js';
import { startFixture } from '../test/fixture.js';
import sharp from 'sharp';
import { unlockVault, vaultRange } from '../src/vault.js';

const data = await mkdtemp(path.join(os.tmpdir(), 'papan-preview-repair-'));
const root = path.join(data, 'library'), fixture = await startFixture();
let library = await openLibrary(root), app, page;
const collection = newCollection('protected preview repair', { mode: 'offline' });
const itemId = randomUUID(), pinId = randomUUID(), password = 'preview-test-password';
const info = await inspectLink(`${fixture.url}/portrait.mp4`);
info.items[0].id = itemId;
const saved = await materialize({ ...info, id: pinId, collectionId: collection.id, coverId: itemId,
  title: 'portrait color check', tags: ['keep'], notes: 'preserve this note', previews: [{ itemId, start: .1, end: .8 }] }, root, true);
const original = await readFile(path.join(root, 'media', saved.items[0].localFile));
const bundledFFmpeg = path.resolve('vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const broken = spawnSync(existsSync(bundledFFmpeg) ? bundledFFmpeg : developmentFFmpeg,
  ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', path.join(root, 'media', saved.items[0].localFile),
    '-an', '-vf', 'scale=406:720', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'media', saved.items[0].previewFile)]);
assert.equal(broken.status, 0, broken.error?.message || broken.stderr?.toString());
delete saved.items[0].previewVersion;
await library.mutate(draft => { draft.collections.push(collection); draft.pins.push(saved); });
await library.mutate(draft => library.protection.setPassword(draft, collection.id, password));
library.protection.clear(); library = null;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath: process.env.PAPAN_EXECUTABLE,
    args: process.env.PAPAN_EXECUTABLE ? [] : [process.cwd()],
    env: { ...process.env, PAPAN_DATA_DIR: data, ELECTRON_RUN_AS_NODE: undefined } });
  page = await app.firstWindow();
  assert.equal(await app.evaluate(() => process.env.DISPLAY), process.env.DISPLAY);
  if (process.env.DISPLAY === ':97') {
    const id = await app.evaluate(({ BrowserWindow }) => '0x' + BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE().toString(16));
    assert.equal(spawnSync('xprop', ['-display', ':97', '-id', id, 'WM_CLASS']).status, 0, 'test window belongs to the isolated display');
  }
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.collection-tab')).toHaveCount(1);
  assert.equal((await page.evaluate(() => window.papan.downloads())).length, 0, 'locked collections do not start repairs');
  await expect(page.locator('#password-dialog')).toBeVisible();
  await page.locator('#collection-password').fill(password);
  await page.locator('#password-form').evaluate(form => form.requestSubmit());
  await expect(page.locator('#password-dialog')).toBeHidden();
}
try {
  await launch();
  await expect.poll(() => page.evaluate(() => window.papan.library().then(data => data.pins[0]?.items[0].previewVersion)), { timeout: 15000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => window.papan.downloads().then(tasks => tasks.length))).toBe(0);
  const repaired = (await page.evaluate(() => window.papan.library())).pins[0];
  for (const field of ['id', 'collectionId', 'coverId', 'title', 'tags', 'notes', 'previews']) assert.deepEqual(repaired[field], saved[field]);
  assert.equal(repaired.items[0].encrypted, true);
  const video = page.locator('.tile-media video');
  await expect(video).toHaveAttribute('src', /\?v=1$/);
  await expect.poll(() => video.evaluate(video => [video.videoWidth, video.videoHeight])).toEqual([406, 720]);
  const pixels = await video.evaluate(async video => {
    while (video.readyState < 2) await new Promise(resolve => setTimeout(resolve, 20));
    video.pause();
    return { width: video.videoWidth, height: video.videoHeight };
  });
  const screenshot = await video.screenshot(), image = sharp(screenshot), size = await image.metadata();
  const left = Math.ceil(size.width * .1), top = Math.ceil(size.height * .1);
  const { data: rgba, info: sampled } = await image.extract({ left, top, width: size.width - left * 2, height: size.height - top * 2 }).raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < rgba.length; i += sampled.channels) if (rgba[i] > 220 && rgba[i + 1] < 50 && rgba[i + 2] < 50) red++;
  pixels.red = red / (sampled.width * sampled.height);
  assert.deepEqual([pixels.width, pixels.height], [406, 720]);
  assert.ok(pixels.red > .99, 'the actual encrypted board preview renders the correct colors');
  const stored = await readFile(path.join(root, 'library.json'), 'utf8');
  const file = path.join(root, 'vaults', JSON.parse(stored).collections[0].vault.file);
  const unlocked = await unlockVault(file, password);
  try {
    const item = unlocked.manifest.pins[0].items[0];
    const bytes = Buffer.concat(await Array.fromAsync(vaultRange(file, unlocked.key, item.vault.original)));
    assert.deepEqual(bytes, original, 'the original remains complete');
  } finally { unlocked.key.fill(0); }
  assert.equal(stored.includes(saved.notes), false, 'the repair keeps metadata encrypted');
  await page.evaluate(async id => { await window.papan.repairPreviews(id); }, pinId);
  await expect.poll(() => page.evaluate(() => window.papan.downloads().then(tasks => tasks.length))).toBe(0);
  await app.close(); app = null;
  await fixture.close();
  await launch();
  assert.equal((await page.evaluate(() => window.papan.library())).pins[0].items[0].previewVersion, 1);
  assert.equal((await page.evaluate(() => window.papan.downloads())).length, 0, 'repaired previews do not download again after restart');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/preview-repair-check.json', JSON.stringify({ status: 'passed', display: process.env.DISPLAY, pixels,
    checks: ['Automatic repair after unlock renders correct pixels through the encrypted media protocol', 'Pin details, clip ranges, complete original, and encryption survive repair', 'Repeated repair and restart avoid another download'] }, null, 2) + '\n');
  console.log('Protected preview repair, rendered colors, preserved original, and restart idempotency passed.');
} finally {
  await app?.close(); await fixture.close(); await rm(data, { recursive: true, force: true });
}
