import { _electron as electron, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHTTPServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startFixture } from '../test/fixture.js';
import { localAddresses } from '../src/phone-receiver.js';

// Run only on an isolated X display, e.g. xvfb-run -a npm run test:phone.
assert.ok(process.env.DISPLAY, 'Use an isolated X display for this test.');
const profile = await mkdtemp(path.join(os.tmpdir(), 'papan-phone-desktop-'));
const fixture = await startFixture(), host = localAddresses()[0]?.address;
assert.ok(host, 'A private IPv4 interface is required to verify the actual local receiver.');
const reserving = createServer(); await new Promise(resolve => reserving.listen(Number(process.env.PAPAN_PHONE_PORT) || 0, host, resolve));
const port = reserving.address().port; await new Promise(resolve => reserving.close(resolve));
const endpoint = `http://${host}:${port}`;
let app, page, config, phoneConfig, bridge; const errors = [], checks = [];
const phoneEndpoint = process.env.PAPAN_PHONE_USB ? `http://127.0.0.1:${port}` : endpoint;
const env = { ...process.env, PAPAN_DATA_DIR: profile, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_OZONE_PLATFORM_HINT: 'x11' }; delete env.WAYLAND_DISPLAY;
const adb = (...args) => {
  const result = spawnSync(process.env.PAPAN_ADB, args, { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
};
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const phoneState = () => JSON.parse(adb('shell', 'run-as', 'com.papan.share', 'cat', 'files/phone-inbox.json'));
async function launch() {
  app = await electron.launch({ executablePath: process.env.PAPAN_EXECUTABLE, args: [...(process.env.PAPAN_EXECUTABLE ? [] : [process.cwd()]), '--ozone-platform=x11'], env });
  assert.equal(await app.evaluate(() => process.env.DISPLAY), process.env.DISPLAY);
  assert.equal(await app.evaluate(({ app }) => app.commandLine.getSwitchValue('ozone-platform')), 'x11');
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  if (process.env.DISPLAY === ':97') {
    const id = await app.evaluate(({ BrowserWindow }) => '0x' + BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE().toString(16));
    assert.equal(spawnSync('xprop', ['-display', ':97', '-id', id, 'WM_CLASS']).status, 0, 'test window belongs to the isolated display');
  }
  await page.waitForFunction(() => Boolean(window.papan));
}
const post = async (id, url, authentication = config) => {
  const response = await fetch(`${endpoint}/v1/shares`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authentication.token}` }, body: JSON.stringify({ id, url }) });
  return { status: response.status, body: await response.json() };
};
try {
  if (process.env.PAPAN_ADB && process.env.PAPAN_PHONE_USB) {
    // A loopback-only test bridge bypasses host firewalls without changing them.
    // Rewrite the pairing response address to match the phone's USB endpoint.
    bridge = createHTTPServer(async (request, response) => {
      try {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const upstream = await fetch(endpoint + request.url, { method: request.method, headers: { 'Content-Type': 'application/json', ...(request.headers.authorization ? { Authorization: request.headers.authorization } : {}) }, ...(body.length ? { body } : {}) });
        const value = await upstream.json();
        if (request.url === '/v1/pair' && upstream.status === 201) value.endpoint = phoneEndpoint;
        response.writeHead(upstream.status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value));
      } catch { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Desktop unavailable.' })); }
    });
    await new Promise(resolve => bridge.listen(port, '127.0.0.1', resolve));
    adb('reverse', `tcp:${port}`, `tcp:${port}`);
  }
  await launch();
  await page.getByRole('button', { name: 'receive from phone', exact: true }).click();
  await expect(page.locator('#phone-dialog')).toBeVisible();
  assert.equal((await page.evaluate(() => window.papan.phoneReceiver())).running, false);
  await page.locator('#phone-enabled').check(); await page.locator('#phone-port').fill(String(port));
  await page.getByRole('button', { name: 'save receiver settings' }).click();
  await expect(page.locator('#phone-status')).toContainText('listening');
  const receiver = await page.evaluate(() => window.papan.phoneReceiver());
  const destination = receiver.collectionId;
  assert.equal((await page.evaluate(() => window.papan.library())).collections[0].name, 'Inbox');
  await page.getByRole('button', { name: 'pair a phone', exact: true }).click();
  await expect(page.locator('#phone-qr')).toBeVisible();
  const link = await page.locator('#phone-pair-url').inputValue();
  const paired = await fetch(`${endpoint}/v1/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: new URL(link).hash.slice(1), name: 'desktop integration client' }) });
  config = await paired.json(); assert.equal(paired.status, 201);
  await expect(page.locator('#phone-devices')).toContainText('desktop integration client'); await expect(page.locator('#phone-pairing')).toBeHidden();
  const id = randomUUID(); assert.equal((await post(id, `${fixture.url}/album`)).status, 202);
  await expect.poll(() => page.evaluate(() => window.papan.library().then(l => l.pins.length))).toBe(1);
  await expect(page.locator('#phone-entries')).toContainText('saved');
  const saved = await page.evaluate(() => window.papan.library());
  assert.equal(saved.pins[0].collectionId, destination); assert.equal(saved.pins[0].items.filter(item => item.kind === 'image').length, 3);
  await expect(page.locator('.pin')).toHaveCount(1);
  assert.equal((await post(id, `${fixture.url}/album`)).status, 200);
  checks.push('Actual desktop UI/IPC, QR pairing, HTTP capture, extraction, cached media, board refresh, and duplicate receipt');

  if (process.env.PAPAN_ADB) {
    await page.getByRole('button', { name: 'pair a phone', exact: true }).click();
    const phoneLink = await page.locator('#phone-pair-url').inputValue();
    const uri = `papan-pair://connect?endpoint=${encodeURIComponent(phoneEndpoint)}&code=${new URL(phoneLink).hash.slice(1)}`;
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', quote(uri), '-n', 'com.papan.share/.MainActivity');
    await expect.poll(() => { try { return phoneState().config?.serverId; } catch { return ''; } }, { timeout: 20000 }).toBe(config.serverId);
    phoneConfig = phoneState().config;
    adb('shell', 'am', 'start', '-a', 'android.intent.action.SEND', '-t', 'text/plain', '--es', 'android.intent.extra.TEXT', quote(`An image to keep ${fixture.url}/wide.png`), '-n', 'com.papan.share/.MainActivity');
    await expect.poll(() => page.evaluate(() => window.papan.library().then(l => l.pins.length)), { timeout: 20000 }).toBe(2);
    // Foreground re-entry checks the desktop's completed receipt.
    adb('shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-n', 'com.papan.share/.MainActivity');
    await expect.poll(() => phoneState().entries.length, { timeout: 30000 }).toBe(0);
    checks.push(`USB-connected Android: actual pairing intent, ACTION_SEND with surrounding text, ${bridge ? 'USB tunnel' : 'local Wi-Fi'} delivery, and saved receipt`);
  }
  await page.locator('[data-close="phone-dialog"]').click(); await app.close(); app = null;
  if (process.env.PAPAN_ADB) {
    adb('shell', 'am', 'start', '-a', 'android.intent.action.SEND', '-t', 'text/plain', '--es', 'android.intent.extra.TEXT', quote(`${fixture.url}/article`), '-n', 'com.papan.share/.MainActivity');
    await expect.poll(() => phoneState().entries.length, { timeout: 20000 }).toBe(1);
    assert.equal(phoneState().entries[0].received, false);
    adb('shell', 'am', 'force-stop', 'com.papan.share');
    assert.equal(phoneState().entries.length, 1);
  }
  await launch();
  assert.equal((await post(id, `${fixture.url}/album`)).status, 200);
  if (process.env.PAPAN_ADB) {
    adb('shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-n', 'com.papan.share/.MainActivity');
    await expect.poll(() => page.evaluate(() => window.papan.library().then(l => l.pins.length)), { timeout: 25000 }).toBe(3);
    adb('shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-n', 'com.papan.share/.MainActivity');
    await expect.poll(() => phoneState().entries.length, { timeout: 30000 }).toBe(0);
    checks.push('Android queue persists while desktop is closed and across Android process stop, then saves when both return');
  }
  await page.evaluate(id => window.papan.revokePhone(id), config.deviceId);
  assert.equal((await post(randomUUID(), `${fixture.url}/wide.png`)).status, 401);
  await page.evaluate(id => window.papan.protectCollection({ id, password: 'phone-test-password' }), destination);
  const contents = await readFile(path.join(profile, 'library', 'phone-receiver.json'), 'utf8');
  assert.equal(contents.includes(fixture.url), false);
  await page.evaluate(id => window.papan.lockCollection({ id }), destination);
  assert.equal(JSON.stringify(await page.evaluate(() => window.papan.phoneReceiver())).includes(fixture.url), false);
  checks.push('Restart idempotency, token revocation, and encryption/lock integration leave no shared URL plaintext in the inbox');
  assert.deepEqual(errors, []);
  await mkdir('artifacts', { recursive: true });
  await page.getByRole('button', { name: 'Receive from phone', exact: true }).click();
  await page.locator('#phone-dialog').screenshot({ path: 'artifacts/phone-sharing.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 400));
  await expect.poll(() => page.locator('#phone-dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const bounds = await page.locator('#phone-dialog').evaluate(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: innerHeight }; });
  assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height);
  checks.push('Phone sharing panel fits a 560×400 desktop window without horizontal overflow');
  await writeFile(process.env.PAPAN_EXECUTABLE ? 'artifacts/phone-package-check.json' : 'artifacts/phone-check.json', JSON.stringify({ status: 'passed', display: process.env.DISPLAY, android: Boolean(process.env.PAPAN_ADB), transport: bridge ? 'USB tunnel; LAN reachability not verified' : 'local network', checks }, null, 2) + '\n');
  console.log(checks.join('\n'));
} finally {
  if (phoneConfig && app) await page.evaluate(id => window.papan.revokePhone(id), phoneConfig.deviceId).catch(() => {});
  await app?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true });
  if (bridge) { adb('reverse', '--remove', `tcp:${port}`); bridge.closeAllConnections(); await new Promise(resolve => bridge.close(resolve)); }
}
