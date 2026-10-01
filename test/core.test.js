import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openLibrary, newCollection, collectionSettings } from '../src/library.js';
import { parsePage, routeSource, webURL, inspectLink, materialize } from '../src/media.js';
import { startFixture } from './fixture.js';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import developmentFFmpeg from 'ffmpeg-static';

test('only web URLs are accepted and target sites require individual posts', () => {
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'https://name:password@example.com', 'not a link']) assert.throws(() => webURL(value));
  assert.equal(routeSource('https://x.com/test/status/123456'), 'gallery');
  assert.equal(routeSource('https://www.instagram.com/p/ABC123/'), 'gallery');
  assert.equal(routeSource('https://www.youtube.com/watch?v=abc'), 'video');
  assert.equal(routeSource('https://youtu.be/abc'), 'video');
  assert.throws(() => routeSource('https://youtube.com/playlist?list=abc'));
  assert.throws(() => routeSource('https://instagram.com/someone/'));
  assert.throws(() => routeSource('https://x.com/someone'));
  assert.equal(routeSource('https://youtube.com.evil.example/test'), 'page');
});

test('page discovery deduplicates images, finds a video and readable text without running scripts', () => {
  const html = `<html><head><title>An article</title><meta property="og:image" content="/photo.png"></head><body><article><h1>An article</h1><p>${'Useful article content with enough detail to read offline. '.repeat(12)}</p><img src="/photo.png"><img src="javascript:alert(1)"><video src="/clip.mp4" poster="/photo.png"></video></article><script>throw new Error('must not run')</script></body></html>`;
  const result = parsePage(html, 'https://example.com/post');
  assert.deepEqual(result.items.map(item => item.kind), ['image', 'video', 'text']);
  assert.equal(result.items[0].url, 'https://example.com/photo.png');
  assert.ok(result.items[2].text.includes('Useful article'));
  assert.equal(parsePage(`<html><title>Text only</title><article><p>${'A longer paragraph on a text-only page. '.repeat(12)}</p></article></html>`, 'https://example.com').items[0].kind, 'text');
});

test('library serializes overlapping writes, persists, keeps the previous snapshot and preserves invalid data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-store-'));
  try {
    const store = await openLibrary(root);
    await Promise.all(Array.from({ length: 12 }, (_, index) => store.mutate(async draft => { draft.collections.push(newCollection(`board ${index}`)); })));
    assert.equal((await openLibrary(root)).snapshot().collections.length, 12);
    assert.equal(JSON.parse(await readFile(path.join(root, 'library.previous.json'))).collections.length, 11);
    const legacy = JSON.parse(await readFile(path.join(root, 'library.json')));
    delete legacy.collections[0].settings.density;
    legacy.collections[0].settings.tileSize = 'small';
    await writeFile(path.join(root, 'library.json'), JSON.stringify(legacy));
    assert.equal((await openLibrary(root)).snapshot().collections[0].settings.density, 4);
    assert.equal(JSON.parse(await readFile(path.join(root, 'library.json'))).collections[0].settings.tileSize, 'small');
    await assert.rejects(store.mutate(draft => { draft.collections = []; throw new Error('rollback'); }));
    assert.equal(store.snapshot().collections.length, 12);
    await writeFile(path.join(root, 'library.json'), '{invalid');
    await assert.rejects(openLibrary(root), /preserved/);
    assert.equal(await readFile(path.join(root, 'library.json'), 'utf8'), '{invalid');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('collection settings validate boundary values', () => {
  assert.equal(collectionSettings({ mode: 'offline' }).motion, true);
  assert.equal(collectionSettings().density, 3);
  assert.equal(collectionSettings().fit, 'contain');
  assert.equal(collectionSettings({ slideshowSeconds: 7 }).slideshowSeconds, 7);
  for (const value of [1, 10]) {
    assert.equal(collectionSettings({ density: value }).density, value);
    assert.equal(collectionSettings({ slideshowSeconds: value }).slideshowSeconds, value);
  }
  assert.equal(collectionSettings({ columns: 7 }).density, 7);
  for (const [tileSize, density] of [['small', 4], ['medium', 3], ['large', 2]]) assert.equal(collectionSettings({ tileSize }).density, density);
  for (const input of [{ mode: 'anything' }, { density: 0 }, { density: 11 }, { density: 1.5 }, { tileSize: 'huge' }, { slideshowSeconds: 0 }, { slideshowSeconds: 11 }, { slideshowSeconds: 2.5 }, { motion: 'yes' }]) assert.throws(() => collectionSettings(input));
  assert.throws(() => newCollection('  '));
});

test('real downloads save selected files, reject HTML-as-media, and roll back incomplete albums', async () => {
  const fixture = await startFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-download-'));
  await openLibrary(root);
  try {
    const info = await inspectLink(`${fixture.url}/album`);
    const images = info.items.filter(item => item.kind === 'image');
    assert.equal(images.length, 3);
    const pin = await materialize({ sourceUrl: info.sourceUrl, engine: 'page', items: [{ ...images[1], previewPath: path.join(root, 'old-preview.webp'), localPath: path.join(root, 'old-original.png') }] }, root, true);
    assert.equal(pin.items.length, 1);
    assert.match(await readFile(path.join(root, 'media', pin.items[0].localFile), 'utf8'), /blue/);
    assert.equal(pin.items[0].previewWidth, 1280);
    assert.equal(pin.items[0].previewHeight, 640);
    assert.notEqual(pin.items[0].previewFile, pin.items[0].localFile);
    assert.equal(pin.items[0].previewPath, null, 'newly downloaded media replaces references to an older location');
    assert.equal(pin.items[0].localPath, null);
    const wide = await inspectLink(`${fixture.url}/wide.png`);
    const offlineImage = await materialize(wide, root, true);
    const original = await sharp(path.join(root, 'media', offlineImage.items[0].localFile)).metadata();
    const preview = await sharp(path.join(root, 'media', offlineImage.items[0].previewFile)).metadata();
    assert.deepEqual([original.width, original.height], [3200, 1600]);
    assert.deepEqual([preview.width, preview.height], [1280, 640]);
    const animated = await materialize(await inspectLink(`${fixture.url}/animated.gif`), root, false);
    const animatedPreview = await sharp(path.join(root, 'media', animated.items[0].previewFile), { animated: true }).metadata();
    assert.equal(animatedPreview.pages, 2);
    assert.deepEqual(animatedPreview.delay, [100, 200]);
    assert.deepEqual([animated.items[0].previewWidth, animated.items[0].previewHeight], [32, 24]);
    assert.equal(animated.items[0].localFile, null);
    await assert.rejects(materialize({ sourceUrl: info.sourceUrl, engine: 'page', items: [images[0], { ...images[1], url: `${fixture.url}/not-media` }] }, root, true), /instead of the selected media/);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(path.join(root, 'staging')), []);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(inspectLink(`${fixture.url}/album`, controller.signal));
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('portrait video previews preserve decoded colors after downscaling', async () => {
  const fixture = await startFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-video-colors-'));
  await openLibrary(root);
  try {
    const saved = await materialize(await inspectLink(`${fixture.url}/portrait.mp4`), root, true);
    const preview = path.join(root, 'media', saved.items[0].previewFile);
    const bundledFFmpeg = path.resolve('vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const decoded = spawnSync(existsSync(bundledFFmpeg) ? bundledFFmpeg : developmentFFmpeg,
      ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', preview, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    assert.equal(decoded.status, 0, decoded.error?.message || decoded.stderr?.toString());
    assert.equal(decoded.stdout.length, 406 * 720 * 3);
    let red = 0;
    for (let offset = 0; offset < decoded.stdout.length; offset += 3) {
      if (decoded.stdout[offset] > 220 && decoded.stdout[offset + 1] < 50 && decoded.stdout[offset + 2] < 50) red++;
    }
    assert.ok(red / (406 * 720) > .99, 'the red source must stay red across the entire preview, without pink/green corruption');
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
