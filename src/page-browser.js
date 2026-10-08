import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { webURL, extractWorker } from './media.js';

// Run in an isolated browser world: copy the DOM, never page-provided functions.
export function renderedPageHTML() {
  const copy = document.documentElement.cloneNode(true);
  const original = document.querySelectorAll('img, video, source');
  const cloned = copy.querySelectorAll('img, video, source');
  for (let index = 0; index < original.length; index++) {
    const media = original[index], target = cloned[index];
    if (media.closest('[hidden], [aria-hidden="true"]')) {
      target.remove();
      continue;
    }
    if (media.currentSrc && !/^(data|blob):/.test(media.currentSrc)) {
      target.setAttribute('src', media.currentSrc);
      if (media.tagName !== 'IMG') target.removeAttribute('srcset');
    }
  }
  copy.querySelectorAll('script, noscript, [hidden], [aria-hidden="true"]').forEach(node => node.remove());
  const html = copy.outerHTML;
  if (html.length > 6 * 1024 * 1024) throw new Error('The rendered page is too large to inspect.');
  return { html, url: document.baseURI };
}

export async function renderPage(url, signal, browser = '') {
  url = webURL(url);
  signal?.throwIfAborted();
  const cookies = browser ? await extractWorker({ action: 'browser-cookies', url, browser }, signal) : [];
  signal?.throwIfAborted();
  const { BrowserWindow, session } = await import('electron');
  const isolated = session.fromPartition(`papan-inspect-${randomUUID()}`, { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', event => event.preventDefault());
  const pending = new Set();
  isolated.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data|blob):/.test(details.url);
    try { webURL(details.url); allowed = true; } catch {}
    if (allowed) pending.add(details.id);
    callback({ cancel: !allowed });
  });
  isolated.webRequest.onCompleted(details => pending.delete(details.id));
  isolated.webRequest.onErrorOccurred(details => pending.delete(details.id));
  const page = new BrowserWindow({ show: false, width: 1280, height: 900, focusable: false, skipTaskbar: true,
    webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      backgroundThrottling: false, offscreen: true, spellcheck: false, autoplayPolicy: 'user-gesture-required' } });
  page.webContents.setAudioMuted(true);
  page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  page.webContents.on('will-attach-webview', event => event.preventDefault());
  let timer, cancel;
  const stopped = new Promise((_resolve, reject) => {
    cancel = () => { if (!page.isDestroyed()) page.destroy(); reject(new Error('Cancelled.')); };
    timer = setTimeout(() => { if (!page.isDestroyed()) page.destroy(); reject(new Error('The page took too long to render.')); }, 20000);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
  try {
    return await Promise.race([stopped, (async () => {
      for (const { hostOnly, ...cookie } of cookies) {
        signal?.throwIfAborted();
        if (page.isDestroyed()) throw new Error('Cancelled.');
        const origin = new URL(url); if (cookie.secure) origin.protocol = 'https:';
        try { await isolated.cookies.set({ ...cookie, url: origin.origin + cookie.path, domain: hostOnly ? undefined : cookie.domain }); }
        catch { throw new Error('The browser session could not be loaded for this page. Sign in to the site in your browser, then retry.'); }
      }
      await page.loadURL(webURL(url));
      let result, previous = '', stable = 0;
      const started = Date.now();
      do {
        await delay(250);
        result = await page.webContents.executeJavaScriptInIsolatedWorld(998, [{ code: `(${renderedPageHTML.toString()})()` }]);
        stable = !pending.size && result.html === previous ? stable + 250 : 0;
        previous = result.html;
        if (Date.now() - started >= 1500 && stable >= 1000 && /<(?:img|video)\b[^>]*\bsrc\s*=/i.test(result.html)) break;
      } while (Date.now() - started < 8000);
      return result;
    })()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    if (!page.isDestroyed()) page.destroy();
    await isolated.clearStorageData();
  }
}
