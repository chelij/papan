import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { load } from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import developmentFFmpeg from 'ffmpeg-static';
import sharp from 'sharp';

// Staging files are renamed/removed immediately; cached handles lock them on Windows.
sharp.cache({ files: 0 });
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledFFmpeg = path.join(project, 'vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffmpeg = existsSync(bundledFFmpeg) ? bundledFFmpeg : developmentFFmpeg;
export const MAX_FILE = 512 * 1024 * 1024;
export const BROWSER_SESSION_MODES = ['', 'auto'];
const MAX_HTML = 6 * 1024 * 1024;

export function webURL(value, base) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Paste a valid web link.');
  let url;
  try { url = new URL(value.trim(), base); } catch { throw new Error('Paste a complete link starting with https://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP and HTTPS links without embedded credentials are supported.');
  return url.href;
}

export function routeSource(value) {
  const url = new URL(webURL(value));
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host)) {
    if (!/^\/(?:[^/]+\/status|i\/web\/status)\/\d+/.test(url.pathname)) throw new Error('Paste a single X post, rather than a profile or feed.');
    return 'gallery';
  }
  if (['instagram.com', 'm.instagram.com'].includes(host)) {
    if (!/^\/(p|reel|reels|tv)\/[^/]+/.test(url.pathname)) throw new Error('Paste a single Instagram post or reel.');
    return 'gallery';
  }
  if (['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    if (host !== 'youtu.be' && !url.searchParams.get('v') && !/^\/(shorts|embed)\//.test(url.pathname)) throw new Error('Paste a single YouTube video, rather than a channel or playlist.');
    return 'video';
  }
  return 'page';
}

function run(command, args, { input, signal, timeout = 90000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled.'));
    const child = spawn(command, args, { windowsHide: true, shell: false, detached: process.platform !== 'win32', env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      error ? reject(error) : resolve(result);
    };
    const stop = message => {
      if (child.pid) {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      }
      finish(new Error(message));
    };
    const cancel = () => stop('Cancelled.');
    const timer = setTimeout(() => stop('The source took too long to respond. Try again later.'), timeout);
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 12 * 1024 * 1024) stop('The source returned too much data. Paste an individual post.');
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', error => finish(new Error(`Could not start the media tools: ${error.message}`)));
    child.on('close', code => finish(null, { code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}

export async function extractWorker(request, signal) {
  const executable = path.join(project, 'vendor', process.platform === 'win32' ? 'papan-extract.exe' : 'papan-extract');
  let command = executable, args = [];
  try { if (process.env.PAPAN_PYTHON_WORKER === '1') throw new Error('Use source helper'); await access(executable); } catch {
    command = path.join(project, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    args = [path.join(project, 'worker', 'extract.py')];
    try { await access(command); } catch { throw new Error('Media tools are missing. Run npm run setup in the project, or reinstall the packaged app.'); }
  }
  const result = await run(command, args, {
    input: JSON.stringify({ ...request, ffmpeg, node: process.execPath }), signal,
    timeout: ['download', 'export-bundle', 'import-bundle'].includes(request.action) ? 300000 : 70000,
    env: { ELECTRON_RUN_AS_NODE: '1', PYTHONNOUSERSITE: '1' },
  });
  let data;
  try { data = JSON.parse(result.stdout); } catch { throw new Error('The media extractor stopped unexpectedly. Try again or check the source link.'); }
  if (!data.ok) {
    const reason = data.error || 'The source could not be extracted.';
    if (!request.browser && /^['"]?Unavailable['"]?$/i.test(reason) && request.url && ['x.com', 'twitter.com', 'mobile.twitter.com'].includes(new URL(request.url).hostname.replace(/^www\./, ''))) throw new Error('X did not expose this post to Papan’s public downloader. Enable browser-session fallback in Privacy settings if it needs login.');
    if (request.browser) throw new Error(`Browser-session fallback failed. ${reason.replace(/https?:\/\/\S+/g, '[source]').slice(0, 300)}`);
    if (/login|sign.in|cookie|authenticat|private|401|403|checkpoint|challenge/i.test(reason)) {
      throw new Error('This source is not available to public-only extraction right now. Papan does not use your login or browser cookies.');
    }
    throw new Error(reason.replace(/https?:\/\/\S+/g, '[source]').slice(0, 400));
  }
  return data.result;
}

async function fetchWeb(value, { signal, headers = {}, method = 'GET' } = {}) {
  let url = webURL(value);
  for (let redirects = 0; redirects < 6; redirects++) {
    const response = await fetch(url, { method, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), redirect: 'manual', headers: { 'User-Agent': 'Papan/0.1 (+public media collector)', ...headers } });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel();
      url = webURL(response.headers.get('location'), url);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`The source returned HTTP ${response.status}. It may be unavailable or require a login.`); }
    return { response, url };
  }
  throw new Error('The link redirected too many times.');
}

function sizeLimiter(max) {
  let bytes = 0;
  return new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    callback(bytes > max ? new Error(`The file exceeds the ${Math.round(max / 1024 / 1024)} MiB limit.`) : null, chunk);
  } });
}

function kindFromType(type) {
  return type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : null;
}

function candidate(url, kind, extra = {}) {
  return { key: createHash('sha256').update(url).digest('hex').slice(0, 24), kind, url, ...extra };
}

export function parsePage(html, sourceUrl) {
  const $ = load(html);
  const resolve = value => { try { return webURL(value, sourceUrl); } catch { return null; } };
  const title = $('meta[property="og:title"]').attr('content') || $('title').text() || new URL(sourceUrl).hostname;
  const items = [], seen = new Set();
  const add = (value, kind, extra) => {
    const url = resolve(value);
    if (url && !seen.has(url) && items.length < 50) { seen.add(url); items.push(candidate(url, kind, extra)); }
  };
  $('meta[property="og:image"], meta[property="og:image:secure_url"]').each((_, el) => add($(el).attr('content'), 'image'));
  $('video').each((_, el) => {
    const video = $(el);
    const src = video.attr('src') || video.find('source').first().attr('src');
    if (src) add(src, 'video', { poster: resolve(video.attr('poster')) });
  });
  const scope = $('article').length ? $('article') : $('main').length ? $('main') : $('body');
  scope.find('img').each((_, el) => {
    const img = $(el);
    if ((Number(img.attr('width')) > 0 && Number(img.attr('width')) < 100) || (Number(img.attr('height')) > 0 && Number(img.attr('height')) < 80)) return;
    add(img.attr('data-src') || img.attr('src'), 'image', { alt: (img.attr('alt') || '').slice(0, 250) });
  });
  const document = new JSDOM(html, { url: sourceUrl });
  let article;
  try { article = new Readability(document.window.document, { maxElemsToParse: 50000 }).parse(); }
  finally { document.window.close(); }
  const text = (article?.textContent || $('meta[name="description"]').attr('content') || '').trim().slice(0, 100000);
  if (text.length >= 80) items.push({ key: 'text', kind: 'text', text });
  if (!items.length) throw new Error('No public images, videos, or readable article text were found on this page.');
  return { sourceUrl, title: title.trim().slice(0, 200), author: article?.byline || '', text, items: items.slice(0, 50), engine: 'page' };
}

export async function inspectLink(input, signal, browser = '') {
  if (!BROWSER_SESSION_MODES.includes(browser)) throw new Error('Invalid browser-session mode.');
  const sourceUrl = webURL(input);
  let engine = routeSource(sourceUrl);
  if (engine !== 'page') {
    let data;
    try { data = await extractWorker({ action: 'inspect', url: sourceUrl, engine }, signal); }
    catch (error) {
      if (signal?.aborted) throw error;
      const engines = engine === 'gallery' ? ['gallery', new URL(sourceUrl).hostname.endsWith('instagram.com') ? 'instagram' : 'video'] : [engine];
      for (const candidate of engines.slice(1)) {
        try { data = await extractWorker({ action: 'inspect', url: sourceUrl, engine: candidate }, signal); engine = candidate; break; }
        catch { if (signal?.aborted) throw error; }
      }
      if (!data && browser) {
        let failure;
        for (const candidate of engines) {
          try { data = await extractWorker({ action: 'inspect', url: sourceUrl, engine: candidate, browser }, signal); engine = candidate; break; }
          catch (e) { failure ||= e; if (signal?.aborted) throw e; }
        }
        if (!data) throw failure;
      }
      if (!data) throw error;
    }
    const items = data.items.map(item => ({ ...item, url: safeRemote(item.url), poster: safeRemote(item.poster) }));
    if (data.text?.trim()) items.push({ key: 'text', kind: 'text', text: data.text });
    return { ...data, sourceUrl, engine, items: items.slice(0, 50) };
  }
  const { response, url } = await fetchWeb(sourceUrl, { signal });
  // Redirects can turn short links into a known source.
  if (routeSource(url) !== 'page') { await response.body?.cancel(); return inspectLink(url, signal, browser); }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const kind = kindFromType(contentType);
  if (kind) {
    await response.body?.cancel();
    return { sourceUrl, title: decodeURIComponent(new URL(url).pathname.split('/').pop() || 'Saved media'), author: '', text: '', engine: 'page', items: [candidate(url, kind)] };
  }
  if (!contentType.includes('html') && !contentType.includes('text/plain')) { await response.body?.cancel(); throw new Error('This link is not an image, video, or readable page.'); }
  const chunks = [];
  const stream = Readable.fromWeb(response.body).pipe(sizeLimiter(MAX_HTML));
  for await (const chunk of stream) chunks.push(chunk);
  return parsePage(Buffer.concat(chunks).toString('utf8'), url);
}

function safeRemote(value) { try { return value ? webURL(value) : null; } catch { return null; } }

async function downloadDirect(item, destination, signal) {
  const { response } = await fetchWeb(item.url, { signal });
  const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const detected = kindFromType(type);
  if (detected !== item.kind) { await response.body?.cancel(); throw new Error('The source returned a page instead of the selected media.'); }
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
  if (!extensions[type]) { await response.body?.cancel(); throw new Error(`This media format is not supported yet (${type}).`); }
  const target = `${destination}.${extensions[type]}`;
  const partial = `${target}.part`;
  try {
    if (Number(response.headers.get('content-length')) > MAX_FILE) throw new Error('This media exceeds the 512 MiB limit.');
    await pipeline(Readable.fromWeb(response.body), sizeLimiter(MAX_FILE), createWriteStream(partial, { mode: 0o600 }), { signal });
    if (!(await stat(partial)).size) throw new Error('The source returned an empty file.');
    await rename(partial, target);
    return target;
  } catch (error) { await rm(partial, { force: true }); throw error; }
}

export async function materialize(pin, root, offline, signal, progress = () => {}, browser = '') {
  if (!BROWSER_SESSION_MODES.includes(browser)) throw new Error('Invalid browser-session mode.');
  const folder = randomUUID();
  const stage = path.join(root, 'staging', folder);
  const destination = path.join(root, 'media', folder);
  await mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    const media = pin.items.filter(item => item.kind !== 'text');
    let extracted = [];
    if (media.length && pin.engine !== 'page') {
      progress(offline ? 'downloading selected media…' : 'preparing previews…');
      const request = { action: 'download', engine: pin.engine, url: pin.sourceUrl, keys: media.map(item => item.key), output: stage, preview: !offline };
      try { extracted = await extractWorker(request, signal); }
      catch (error) {
        if (!browser || signal?.aborted) throw error;
        // A failed album may have left partial files; retry the same selection cleanly.
        await rm(stage, { recursive: true, force: true }); await mkdir(stage, { recursive: true, mode: 0o700 });
        progress('retrying with browser session…');
        extracted = await extractWorker({ ...request, browser }, signal);
      }
    }
    const items = [];
    for (const [index, item] of pin.items.entries()) {
      signal?.throwIfAborted();
      progress(`saving ${index + 1} of ${pin.items.length}…`);
      if (item.kind === 'text') { items.push({ ...item }); continue; }
      let file = pin.engine === 'page' ? await downloadDirect(item, path.join(stage, randomUUID()), signal) : extracted.find(result => result.key === item.key)?.file;
      if (!file || path.dirname(path.resolve(file)) !== path.resolve(stage)) throw new Error('The extractor returned an invalid media file.');
      if ((await stat(file)).size > MAX_FILE) throw new Error('This media exceeds the 512 MiB limit.');
      let preview;
      let previewWidth, previewHeight;
      if (item.kind === 'video') {
        preview = path.join(stage, `${randomUUID()}.mp4`);
        const result = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i', file,
          '-an', '-vf', "scale=w='min(720,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic+accurate_rnd,setsar=1,fps=24",
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', preview], { signal, timeout: 300000 });
        if (result.code || !(await stat(preview)).size) throw new Error('Papan could not prepare a playable preview for this video.');
      } else {
        preview = path.join(stage, `${randomUUID()}.webp`);
        await sharp(file, { animated: true, limitInputPixels: 100000000 }).autoOrient()
          .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).timeout({ seconds: 45 }).toFile(preview);
        const metadata = await sharp(preview, { animated: true }).metadata();
        previewWidth = metadata.width;
        previewHeight = metadata.pageHeight || metadata.height;
      }
      signal?.throwIfAborted();
      if ((await stat(preview)).size > MAX_FILE) throw new Error('The preview exceeds the 512 MiB limit.');
      // Keep reduced display copies online; offline collections also retain the originals.
      const localFile = offline ? `${folder}/${path.basename(file)}` : null;
      const previewFile = `${folder}/${path.basename(preview)}`;
      if (!offline && preview !== file) await rm(file, { force: true });
      items.push({ ...item, localPath: null, previewPath: null, localFile, previewFile, previewWidth, previewHeight, ...(item.kind === 'video' ? { previewVersion: 1 } : {}) });
    }
    await rename(stage, destination);
    return { ...pin, items, folder, offline };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function removeMedia(root, folder) {
  if (/^[0-9a-f-]{36}$/.test(folder || '')) await rm(path.join(root, 'media', folder), { recursive: true, force: true });
}
