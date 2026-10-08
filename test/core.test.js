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

test('page discovery finds lazy and responsive JPEGs across ordinary sites', () => {
  const result = parsePage(`<html><meta name="twitter:image" content="/shared.jpg"><main>
    <img src="data:image/gif;base64,AAAA" data-original="/original.jpg">
    <img data-lazy-src="/lazy.jpg">
    <img src="/small.jpg" srcset="/small.jpg 320w, /large.jpg 1600w">
    <picture><source srcset="/picture-small.jpg 1x, /picture-large.jpg 2x"><img src="/fallback.jpg"></picture>
    <img data-srcset="/responsive.jpg 1200w" src="/placeholder.jpg">
    <img data-src="javascript:alert(1)">
  </main></html>`, 'https://example.com/article');
  assert.deepEqual(result.items.map(item => item.url), ['shared.jpg', 'original.jpg', 'lazy.jpg', 'large.jpg', 'picture-large.jpg', 'responsive.jpg'].map(name => `https://example.com/${name}`));
});

test('page discovery selects main media before unrelated articles', () => {
  const info = parsePage('<html><title>Reference</title><article><img src="/advert.jpg"><video src="/advert.mp4"></video></article><main><img src="/reference.jpg"><video src="/reference.mp4"></video></main></html>', 'https://example.com/post');
  assert.deepEqual(info.items.filter(item => item.kind !== 'text').map(item => item.url), ['https://example.com/reference.mp4', 'https://example.com/reference.jpg']);
});

test('Reddit galleries retain ordered originals and exclude advertisements, previews and comments', () => {
  const html = `<html><title>Reddit</title><meta property="og:image" content="https://preview.redd.it/first.jpg?width=320">
    <article><img src="/advert.jpg"></article><main>
    <shreddit-post id="t3_abc123" permalink="/r/example/comments/abc123/photos/" post-title="Photo references" author="fixture">
      <img src="/avatar.png" width="32">
      <gallery-carousel>
        <li><figure><img src="https://preview.redd.it/first.jpg?width=320"><div style="display:none"><img src="https://i.redd.it/first.jpg"></div></figure></li>
        <li style="visibility:hidden"><figure><img src="https://preview.redd.it/second.jpg?width=320"><div style="display:none"><img src="https://i.redd.it/second.jpg"></div></figure></li>
      </gallery-carousel>
    </shreddit-post><img src="/comment.jpg">
    <shreddit-post id="t3_other" permalink="/r/example/comments/other/unrelated/" post-title="Unrelated"><img src="/unrelated.jpg"></shreddit-post>
    </main></html>`;
  for (const url of ['https://www.reddit.com/r/example/comments/abc123/photos/?ref=share', 'https://www.reddit.com/gallery/abc123']) {
    const info = parsePage(html, url);
    assert.equal(info.title, 'Photo references'); assert.equal(info.author, 'fixture'); assert.equal(info.text, '');
    assert.deepEqual(info.items.map(item => item.url), ['https://i.redd.it/first.jpg', 'https://i.redd.it/second.jpg']);
  }
  const text = parsePage('<html><shreddit-post id="t3_text" permalink="/r/example/comments/text/post/" post-title="Notes" author="writer"><div slot="text-body">Keep this post text.</div></shreddit-post><article>Unrelated comments</article></html>', 'https://www.reddit.com/r/example/comments/text/post/');
  assert.equal(text.items[0].text, 'Keep this post text.');
  const legacy = parsePage(`<html><title>Reddit</title><meta property="og:image" content="https://preview.redd.it/first.jpg?width=320">
    <div class="side"><img src="/sidebar.jpg"></div><div class="content">
    <div class="thing link" data-fullname="t3_abc123" data-author="fixture"><a class="title">Photo references</a>
      <img src="https://preview.redd.it/first.jpg?width=320">
      <div class="media-gallery"><a class="gallery-item-thumbnail-link" href="https://preview.redd.it/first.jpg?width=1080&auto=webp"><img src="https://preview.redd.it/first.jpg?width=640"></a>
      <a class="gallery-item-thumbnail-link" href="https://preview.redd.it/second.png?width=1080"><img src="https://preview.redd.it/second.png?width=640"></a></div>
    </div><div class="thing comment" data-fullname="t1_comment"><img src="/comment.jpg"></div></div></html>`, 'https://www.reddit.com/r/example/comments/abc123/photos/');
  assert.equal(legacy.title, 'Photo references'); assert.equal(legacy.author, 'fixture');
  assert.deepEqual(legacy.items.map(item => item.url), ['https://i.redd.it/first.jpg', 'https://i.redd.it/second.png']);
  assert.throws(() => parsePage('<html><title>Reddit - Prove your humanity</title><main>Complete the challenge below to let us know you are a real person.</main></html>', 'https://www.reddit.com/'), /human verification/);
  assert.equal(parsePage('<html><title>How to verify you are human</title><article><img src="/example.jpg"></article></html>', 'https://example.com/article').items[0].kind, 'image');
});

test('scripted pages use rendered discovery, while direct JPEGs and static pages keep the fast path', async () => {
  const fixture = await startFixture();
  try {
    const calls = [];
    const render = async (url, signal) => {
      calls.push({ url, signal });
      return { url, html: '<html><title>Rendered pin</title><main><img src="/photo.jpg"></main></html>' };
    };
    const controller = new AbortController();
    const dynamic = await inspectLink(`${fixture.url}/dynamic`, controller.signal, '', render);
    assert.equal(dynamic.title, 'Rendered pin');
    assert.equal(dynamic.items[0].url, `${fixture.url}/photo.jpg`);
    assert.deepEqual(calls, [{ url: `${fixture.url}/dynamic`, signal: controller.signal }]);
    await inspectLink(`${fixture.url}/photo.jpg`, undefined, '', render);
    await inspectLink(`${fixture.url}/album`, undefined, '', render);
    assert.equal(calls.length, 1);
    const text = await inspectLink(`${fixture.url}/dynamic`, undefined, '', async () => { throw new Error('Renderer unavailable'); });
    assert.equal(text.items.at(-1).kind, 'text', 'readable content survives a rendering failure');
    await assert.rejects(inspectLink(`${fixture.url}/not-media`, undefined, '', async () => { throw new Error('Renderer unavailable'); }), /Renderer unavailable/);
    await assert.rejects(inspectLink(`${fixture.url}/dynamic`, controller.signal, '', async () => { controller.abort(); throw new Error('Cancelled.'); }), /Cancelled/);
    const attempts = [];
    const gated = async (url, _signal, browser = '') => {
      attempts.push(browser);
      return { url, html: browser ? '<title>Signed in</title><main><img src="/photo.jpg"></main>' : '<title>Prove your humanity</title>' };
    };
    await assert.rejects(inspectLink(`${fixture.url}/missing`, undefined, '', gated), /human verification/);
    assert.deepEqual(attempts.splice(0), [''], 'disabled fallback stays anonymous even after HTTP failure');
    const authenticated = await inspectLink(`${fixture.url}/missing`, undefined, 'auto', gated);
    assert.deepEqual(attempts.splice(0), ['', 'auto']);
    assert.equal(authenticated.items[0].url, `${fixture.url}/photo.jpg`);
    await inspectLink(`${fixture.url}/album`, undefined, 'auto', gated);
    assert.deepEqual(attempts, [], 'public pages never request cookies');
  } finally { await fixture.close(); }
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
  for (const density of [0.5, 1.5, 2.5, 10.5, 20]) assert.equal(collectionSettings({ density }).density, density);
  for (const [tileSize, density] of [['small', 4], ['medium', 3], ['large', 2]]) assert.equal(collectionSettings({ tileSize }).density, density);
  for (const input of [{ mode: 'anything' }, ...[0, 20.5, 0.75, 1.25, NaN, Infinity, '3', true].map(density => ({ density })), { tileSize: 'huge' }, { slideshowSeconds: 0 }, { slideshowSeconds: 11 }, { slideshowSeconds: 2.5 }, { motion: 'yes' }]) assert.throws(() => collectionSettings(input));
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
