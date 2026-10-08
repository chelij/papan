import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile, symlink, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

if (!process.versions.electron) {
  const data = await mkdtemp(path.join(os.tmpdir(), 'papan-discovery-'));
  const env = { ...process.env, PAPAN_DATA_DIR: data };
  delete env.DISPLAY; delete env.WAYLAND_DISPLAY; delete env.ELECTRON_RUN_AS_NODE;
  try {
    const executable = createRequire(import.meta.url)('electron');
    const child = spawn(executable, ['--ozone-platform=headless', '--disable-gpu', fileURLToPath(import.meta.url)], { env, stdio: 'inherit' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    clearTimeout(timer);
    assert.equal(code, 0, 'native headless page discovery must pass');
  } finally { await rm(data, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow, session } = await import('electron');
  app.setPath('userData', process.env.PAPAN_DATA_DIR);
  app.on('window-all-closed', () => {});
  void app.whenReady().then(async () => {
    const { inspectLink, materialize, parsePage } = await import('../src/media.js');
    const { renderPage } = await import('../src/page-browser.js');
    const { startFixture } = await import('../test/fixture.js');
    const { openLibrary } = await import('../src/library.js');
    const { default: sharp } = await import('sharp');
    const fixture = await startFixture(), checks = [], partitions = [], cookieScopes = [];
    let abortAfterCookie;
    const root = path.join(process.env.PAPAN_DATA_DIR, 'test-library');
    await openLibrary(root);
    app.on('browser-window-created', (_event, window) => {
      assert.equal(window.isVisible(), false);
      assert.equal(window.isFocusable(), false);
      const preferences = window.webContents.getLastWebPreferences();
      assert.equal(preferences.nodeIntegration, false);
      assert.equal(preferences.sandbox, true);
      assert.equal(preferences.contextIsolation, true);
      assert.equal(preferences.preload, undefined);
      assert.equal(window.webContents.session.isPersistent(), false);
      assert.equal(window.webContents.session.storagePath, null);
      partitions.push(window.webContents.session);
      window.webContents.session.cookies.on('changed', (_event, cookie, _cause, removed) => {
        if (!removed && cookie.name === 'secure_only') cookieScopes.push({ secure: cookie.secure, httpOnly: cookie.httpOnly, hostOnly: cookie.hostOnly, path: cookie.path });
        if (!removed && cookie.name === 'session') abortAfterCookie?.abort();
      });
    });
    let code = 0;
    try {
      assert.equal(process.env.DISPLAY, undefined); assert.equal(process.env.WAYLAND_DISPLAY, undefined);
      assert.equal(app.commandLine.getSwitchValue('ozone-platform'), 'headless');
      const image = await inspectLink(`${fixture.url}/dynamic`, undefined, '', renderPage);
      assert.equal(image.title, 'Loaded reference');
      assert.deepEqual(image.items.filter(item => item.kind === 'image').map(item => item.url), [`${fixture.url}/photo.jpg`]);
      assert.equal(BrowserWindow.getAllWindows().length, 0);
      const saved = await materialize({ ...image, items: image.items.filter(item => item.kind === 'image') }, root, true);
      const original = path.join(root, 'media', saved.items[0].localFile);
      assert.deepEqual(await readFile(original), Buffer.from(await (await fetch(`${fixture.url}/photo.jpg`)).arrayBuffer()));
      assert.deepEqual([saved.items[0].previewWidth, saved.items[0].previewHeight], [1280, 640]);
      assert.equal((await sharp(original).metadata()).format, 'jpeg');
      checks.push('real Electron renders late API media, omits hidden/tiny images, saves exact JPEG bytes and decodes its preview');
      const beforeDirect = partitions.length;
      await inspectLink(`${fixture.url}/photo.jpg`, undefined, '', renderPage);
      await inspectLink(`${fixture.url}/album`, undefined, '', renderPage);
      assert.equal(partitions.length, beforeDirect);
      checks.push('direct JPEGs and ordinary static pages avoid browser rendering');
      const carousel = await inspectLink(`${fixture.url}/carousel`, undefined, '', renderPage);
      assert.deepEqual(carousel.items.filter(item => item.kind === 'image').map(item => item.url), ['wide.png', 'green.svg', 'blue.svg'].map(name => `${fixture.url}/${name}`));
      checks.push('generic galleries keep hidden slides/lightbox originals and choose the largest responsive source');
      const video = await inspectLink(`${fixture.url}/dynamic?video=1`, undefined, '', renderPage);
      assert.equal(video.items.find(item => item.kind === 'video').url, `${fixture.url}/portrait.mp4`);
      const savedVideo = await materialize({ ...video, items: video.items.filter(item => item.kind === 'video') }, root, true);
      assert.deepEqual(await readFile(path.join(root, 'media', savedVideo.items[0].localFile)), await readFile('test/media/portrait.mp4'));
      checks.push('the same generic discovery saves complete late-loading video bytes');
      const authenticatedRoot = path.join(process.env.PAPAN_DATA_DIR, 'authenticated-app');
      await mkdir(path.join(authenticatedRoot, 'src'), { recursive: true });
      await mkdir(path.join(authenticatedRoot, 'vendor'));
      await writeFile(path.join(authenticatedRoot, 'package.json'), '{"type":"module"}');
      await symlink(path.resolve('node_modules'), path.join(authenticatedRoot, 'node_modules'), 'dir');
      for (const file of ['media.js', 'page-browser.js', 'collection-files.js', 'library.js', 'protection.js', 'vault.js']) await copyFile(`src/${file}`, path.join(authenticatedRoot, 'src', file));
      const python = path.resolve('.venv/bin/python'), helper = path.resolve('test/browser-cookie-fixture.py');
      const profile = path.join(process.env.PAPAN_DATA_DIR, 'synthetic-firefox');
      await writeFile(path.join(authenticatedRoot, 'vendor/papan-extract'), `#!${python}\nimport runpy, sys\nsys.argv = [${JSON.stringify(helper)}, ${JSON.stringify(profile)}]\nrunpy.run_path(sys.argv[0], run_name='__main__')\n`, { mode: 0o700 });
      const authenticatedMedia = await import(pathToFileURL(path.join(authenticatedRoot, 'src/media.js')).href);
      const authenticatedBrowser = await import(pathToFileURL(path.join(authenticatedRoot, 'src/page-browser.js')).href);
      const gatedURL = `${fixture.url}/session-page`;
      const attempts = [];
      const render = async (url, signal, browser = '') => {
        attempts.push(browser);
        return authenticatedBrowser.renderPage(url, signal, browser);
      };
      await authenticatedMedia.inspectLink(`${fixture.url}/album`, undefined, 'auto', render);
      assert.deepEqual(attempts, []);
      await assert.rejects(readFile(path.join(profile, 'cookies.sqlite')), { code: 'ENOENT' });
      await assert.rejects(authenticatedMedia.inspectLink(gatedURL, undefined, '', render), /human verification/);
      assert.deepEqual(attempts.splice(0), ['']);
      await assert.rejects(readFile(path.join(profile, 'cookies.sqlite')), { code: 'ENOENT' });
      const authenticated = await authenticatedMedia.inspectLink(gatedURL, undefined, 'auto', render);
      assert.deepEqual(attempts.splice(0), ['', 'auto']);
      assert.equal(authenticated.title, 'Browser session gallery');
      assert.equal(authenticated.items.length, 2);
      await assert.rejects(authenticatedMedia.materialize(authenticated, root, true), /HTTP 403/);
      const authenticatedPin = await authenticatedMedia.materialize(authenticated, root, true, undefined, () => {}, 'auto');
      for (const item of authenticatedPin.items) assert.equal((await sharp(path.join(root, 'media', item.localFile)).metadata()).format, 'jpeg');
      assert.equal(fixture.sessionChecks.foreignCookies, 0);
      assert.equal(fixture.sessionChecks.wrongPathCookies, 0);
      // Chromium and tough-cookie permit Secure cookies on trusted loopback HTTP.
      assert.deepEqual(cookieScopes, [{ secure: true, httpOnly: true, hostOnly: true, path: '/' }]);
      assert.equal(fixture.sessionChecks.expiredCookies, 0);
      assert.ok(fixture.sessionChecks.authenticated > 0 && fixture.sessionChecks.anonymous > 0);
      assert.ok(!JSON.stringify(authenticatedPin).includes('fixture-session'));
      assert.deepEqual(await readdir(path.join(root, 'staging')), []);
      checks.push('production helper reads a synthetic Firefox profile for a blocked webpage, native rendering discovers its private gallery, and downloads decode with scoped cookie retries');
      checks.push('public success and disabled fallback never read cookies; cookie paths, Secure flags and host scope survive rendering and cross-host download redirects without entering saved pins');
      abortAfterCookie = new AbortController();
      try { await assert.rejects(authenticatedBrowser.renderPage(gatedURL, abortAfterCookie.signal, 'auto'), /Cancelled|abort/i); }
      finally { abortAfterCookie = undefined; }
      checks.push('cancellation during authenticated cookie import stops further imports and clears the temporary session');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 100);
      try { await assert.rejects(renderPage(`${fixture.url}/dynamic`, controller.signal), /Cancelled/); }
      finally { clearTimeout(timer); }
      assert.equal(BrowserWindow.getAllWindows().length, 0);
      assert.equal(new Set(partitions).size, partitions.length);
      for (const isolated of partitions) assert.deepEqual(await isolated.cookies.get({}), []);
      assert.deepEqual(await session.defaultSession.cookies.get({}), []);
      checks.push('each inspection stays hidden and sandboxed, uses a separate cleared session, and cancellation destroys its window');
      let live;
      if (process.env.PAPAN_TEST_PAGE_URL) {
        let info;
        if (process.env.PAPAN_TEST_FORCE_BROWSER_SESSION === '1') {
          assert.equal(process.env.PAPAN_TEST_BROWSER_SESSION, 'auto');
          const rendered = await renderPage(process.env.PAPAN_TEST_PAGE_URL, undefined, 'auto');
          info = parsePage(rendered.html, rendered.url);
        } else info = await inspectLink(process.env.PAPAN_TEST_PAGE_URL, undefined, process.env.PAPAN_TEST_BROWSER_SESSION || '', renderPage);
        const selected = info.items.find(item => item.kind === 'image' && /\.jpe?g(?:[?#]|$)/i.test(item.url));
        assert.ok(selected, 'the supplied live page must expose a JPEG');
        const images = process.env.PAPAN_TEST_MEDIA_COUNT ? info.items.filter(item => item.kind === 'image') : [selected];
        if (process.env.PAPAN_TEST_MEDIA_COUNT) assert.equal(images.length, Number(process.env.PAPAN_TEST_MEDIA_COUNT));
        const pin = await materialize({ ...info, items: images }, root, true);
        const metadata = await sharp(path.join(root, 'media', pin.items[0].localFile)).metadata();
        assert.equal(metadata.format, 'jpeg');
        live = { sourceUrl: info.sourceUrl, title: info.title, mediaUrl: selected.url, imageCount: images.length, width: metadata.width, height: metadata.height, forcedBrowserSession: process.env.PAPAN_TEST_FORCE_BROWSER_SESSION === '1' };
        checks.push('the supplied live page exposes a JPEG that downloads and decodes through the production path');
      }
      await mkdir('artifacts', { recursive: true });
      await writeFile('artifacts/discovery-check.json', JSON.stringify({ status: 'passed', display: 'native Electron on isolated headless Ozone', checks, ...(live ? { live } : {}), limits: 'No personal library or main monitor. Visible app/IPC is not covered; a separate full-window attempt hit the headless graphics crash. Cookie-based login is covered with a synthetic profile; personal sessions, browser-bound challenges, click-only and blob-only media are not established by that fixture.' }, null, 2) + '\n');
      console.log(checks.join('\n'));
    } catch (error) { console.error(error); code = 1; }
    finally { for (const window of BrowserWindow.getAllWindows()) window.destroy(); await fixture.close(); app.exit(code); }
  }).catch(error => { console.error(error); app.exit(1); });
}
