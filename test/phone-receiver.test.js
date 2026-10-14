import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { openPhoneReceiver, privateAddress } from '../src/phone-receiver.js';
import { savePhoneLink } from '../src/phone-save.js';
import { openLibrary, newCollection } from '../src/library.js';
import { inspectLink, materialize } from '../src/media.js';
import { startFixture } from './fixture.js';

async function port() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port; await new Promise(resolve => server.close(resolve)); return result;
}
async function until(check) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Phone inbox did not reach the expected state.');
}
const addresses = () => [{ name: 'isolated test', address: '127.0.0.1' }];
async function pair(receiver, endpoint) {
  const qr = await receiver.pair(); assert.match(qr.qr, /^data:image\/png;base64,/);
  const response = await fetch(`${endpoint}/v1/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: new URL(qr.url).hash.slice(1), name: 'test phone' }) });
  assert.equal(response.status, 201); return response.json();
}
const request = (endpoint, config, id, url, headers = {}) => fetch(`${endpoint}/v1/shares${url === undefined ? `/${id}` : ''}`, {
  method: url === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`, ...headers },
  ...(url === undefined ? {} : { body: JSON.stringify({ id, url }) }),
});

test('phone receiver pairs once, commits actual extracted media, survives retries/restarts, and revokes devices', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-phone-')), fixture = await startFixture();
  const library = await openLibrary(root), destination = newCollection('Inbox');
  await library.mutate(draft => draft.collections.push(destination));
  const chosenPort = await port(), endpoint = `http://127.0.0.1:${chosenPort}`;
  let count = 0, receiver;
  const options = { addresses, collection: id => library.requireUnlocked(id), run: (task, signal, progress) => savePhoneLink(task, {
    snapshot: library.snapshot, requireUnlocked: id => library.requireUnlocked(id), inspect: inspectLink,
    save: async ({ pin }, signal) => {
      count++; const saved = await materialize(pin, root, false, signal);
      await library.mutate(draft => draft.pins.push(saved)); return { pin: saved };
    },
  }, signal, progress) };
  try {
    receiver = await openPhoneReceiver(root, options);
    assert.equal(receiver.snapshot().running, false);
    await receiver.configure({ enabled: true, host: '127.0.0.1', port: chosenPort, collectionId: destination.id });
    const pairing = await receiver.pair(), code = new URL(pairing.url).hash.slice(1);
    const attempt = () => fetch(`${endpoint}/v1/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: 'phone' }) });
    const paired = await attempt(), config = await paired.json(); assert.equal(paired.status, 201);
    assert.equal((await attempt()).status, 401);
    assert.equal(JSON.stringify(receiver.snapshot()).includes(config.token), false);
    assert.equal((await readFile(path.join(root, 'phone-receiver.json'), 'utf8')).includes(config.token), false);
    const id = randomUUID(), url = `${fixture.url}/album`;
    assert.equal((await request(endpoint, config, id, url, { Origin: 'https://hostile.example' })).status, 403);
    assert.equal((await request(endpoint, config, id, 'file:///etc/passwd')).status, 400);
    assert.equal((await request(endpoint, config, id, url)).status, 202);
    await until(() => receiver.snapshot().entries[0]?.state === 'saved');
    assert.equal(library.snapshot().pins.length, 1); assert.equal(library.snapshot().pins[0].collectionId, destination.id);
    assert.ok(library.snapshot().pins[0].items.some(item => item.previewFile));
    assert.equal((await request(endpoint, config, id, url)).status, 200); assert.equal(count, 1);
    assert.equal((await request(endpoint, config, id, `${fixture.url}/wide.png`)).status, 409);
    await receiver.stop(); receiver = await openPhoneReceiver(root, options); receiver.pump();
    assert.equal((await (await request(endpoint, config, id)).json()).state, 'saved');
    assert.equal((await request(endpoint, config, id, url)).status, 200); assert.equal(count, 1);
    const other = await pair(receiver, endpoint);
    assert.equal((await request(endpoint, other, id)).status, 404);
    await receiver.revoke(config.deviceId);
    assert.equal((await request(endpoint, config, randomUUID(), url)).status, 401);
    await receiver.configure({ enabled: false, host: '127.0.0.1', port: chosenPort, collectionId: destination.id });
    assert.equal(receiver.snapshot().running, false);
  } finally { await receiver?.stop(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('phone inbox retains failures, resumes accepted URLs, and snapshots the destination at acceptance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-phone-resume-')); let receiver, attempts = [], broken = true, blocked = true;
  const chosenPort = await port(), endpoint = `http://127.0.0.1:${chosenPort}`, first = randomUUID(), second = randomUUID();
  const options = { addresses, available: () => !blocked, collection: () => {}, run: async task => { attempts.push(task.payload.collectionId); if (broken) throw new Error('Source unavailable.'); return {}; } };
  try {
    receiver = await openPhoneReceiver(root, options);
    await receiver.configure({ enabled: true, host: '127.0.0.1', port: chosenPort, collectionId: first });
    const config = await pair(receiver, endpoint), id = randomUUID(); blocked = false;
    await request(endpoint, config, id, 'https://example.com/one');
    await until(() => receiver.snapshot().entries[0]?.state === 'failed');
    assert.match(receiver.snapshot().entries[0].error, /Source unavailable/);
    blocked = true; await receiver.retry(receiver.snapshot().entries[0].id);
    await receiver.configure({ enabled: true, host: '127.0.0.1', port: chosenPort, collectionId: second });
    await receiver.stop(); broken = false; blocked = false;
    receiver = await openPhoneReceiver(root, options); receiver.pump();
    await until(() => receiver.snapshot().entries[0]?.state === 'saved');
    assert.deepEqual(attempts, [first, first]);
    await receiver.clearSaved(); assert.deepEqual(receiver.snapshot().entries, []);
  } finally { await receiver?.stop(); await rm(root, { recursive: true, force: true }); }
});

test('protected phone inbox encrypts URLs, holds new shares on the phone while locked, and resumes after unlock', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-phone-protected-')); let receiver, allow = false;
  const library = await openLibrary(root), target = newCollection('private');
  await library.mutate(draft => draft.collections.push(target));
  const chosenPort = await port(), endpoint = `http://127.0.0.1:${chosenPort}`;
  const options = { addresses, available: () => allow, collection: (id, unlocked = true) => unlocked ? library.requireUnlocked(id) : library.snapshot().collections.find(c => c.id === id), run: async () => ({}),
    codec: { encode: (task, data) => library.protection.encodeTask(task, data || library.snapshot()), decode: task => library.protection.decodeTask(task) } };
  try {
    receiver = await openPhoneReceiver(root, options); await receiver.configure({ enabled: true, host: '127.0.0.1', port: chosenPort, collectionId: target.id });
    const config = await pair(receiver, endpoint);
    // Acceptance is enabled while the worker stays idle until pump is called.
    allow = true; const url = 'https://example.com/private-secret';
    await request(endpoint, config, randomUUID(), url);
    await until(() => receiver.snapshot().entries[0]?.state === 'saved');
    allow = false;
    await library.mutate(draft => library.protection.setPassword(draft, target.id, 'private-password'), async () => {}, async draft => { await receiver.recode(draft); });
    assert.equal((await readFile(path.join(root, 'phone-receiver.json'), 'utf8')).includes('private-secret'), false);
    await library.mutate(draft => library.protection.lock(draft, target.id), async () => {}, async draft => { await receiver.recode(draft); });
    assert.equal(JSON.stringify(receiver.snapshot()).includes('private-secret'), false);
    allow = true;
    assert.equal((await request(endpoint, config, randomUUID(), 'https://example.com/next')).status, 423);
    await library.mutate(draft => library.protection.unlock(draft, target.id, 'private-password'));
    await request(endpoint, config, randomUUID(), 'https://example.com/next');
    await until(() => receiver.snapshot().entries.every(e => e.state === 'saved'));
    assert.equal((await readFile(path.join(root, 'phone-receiver.json'), 'utf8')).includes('example.com'), false);
  } finally { await receiver?.stop(); library.protection.clear(); await rm(root, { recursive: true, force: true }); }
});

test('local binding accepts only private IPv4 addresses', () => {
  for (const address of ['10.0.0.1', '172.16.0.1', '172.31.1.1', '192.168.1.1']) assert.equal(privateAddress(address), true);
  for (const address of ['0.0.0.0', '8.8.8.8', '127.0.0.1', '172.32.0.1', '192.168.1.999', 'example.com', '::1']) assert.equal(privateAddress(address), false);
});

test('interrupted protected captures wait through restart, and password recoding rolls back with the library', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-phone-vault-restart-'));
  let library = await openLibrary(root), receiver, interrupted = true;
  const target = newCollection('private inbox'), chosenPort = await port(), endpoint = `http://127.0.0.1:${chosenPort}`;
  await library.mutate(draft => draft.collections.push(target));
  await library.mutate(draft => library.protection.setPassword(draft, target.id, 'first-password'));
  const options = { addresses, collection: (id, unlocked = true) => unlocked ? library.requireUnlocked(id) : library.snapshot().collections.find(c => c.id === id),
    codec: { encode: (task, data) => library.protection.encodeTask(task, data || library.snapshot()), decode: task => library.protection.decodeTask(task) },
    run: async (_task, signal) => {
      if (!interrupted) return {};
      signal.throwIfAborted();
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Interrupted.')), { once: true }));
    } };
  try {
    receiver = await openPhoneReceiver(root, options); await receiver.configure({ enabled: true, host: '127.0.0.1', port: chosenPort, collectionId: target.id });
    const config = await pair(receiver, endpoint);
    assert.equal((await request(endpoint, config, randomUUID(), 'https://example.com/waiting-secret')).status, 202);
    await until(() => receiver.busy);
    await receiver.stop();
    assert.equal(receiver.snapshot().entries[0].state, 'queued');
    assert.equal((await readFile(path.join(root, 'phone-receiver.json'), 'utf8')).includes('waiting-secret'), false);
    library.protection.clear(); library = await openLibrary(root); interrupted = false;
    receiver = await openPhoneReceiver(root, options); receiver.pump();
    assert.equal(receiver.snapshot().entries[0].locked, true); assert.equal(receiver.snapshot().entries[0].state, 'queued');
    await library.mutate(draft => library.protection.unlock(draft, target.id, 'first-password'));
    const before = await readFile(path.join(root, 'phone-receiver.json'), 'utf8'); let restore;
    await assert.rejects(library.mutate(draft => library.protection.setPassword(draft, target.id, 'second-password', 'first-password'), async () => { await restore?.(); }, async draft => {
      restore = await receiver.recode(draft); throw new Error('Simulated destination write failure.');
    }), /Simulated destination/);
    assert.equal(await readFile(path.join(root, 'phone-receiver.json'), 'utf8'), before);
    assert.equal(receiver.snapshot().entries[0].url, 'https://example.com/waiting-secret');
    await library.mutate(draft => library.protection.setPassword(draft, target.id, 'second-password', 'first-password'), async () => {}, async draft => { await receiver.recode(draft); });
    await receiver.stop(); library.protection.clear(); library = await openLibrary(root);
    receiver = await openPhoneReceiver(root, options); receiver.pump(); assert.equal(receiver.snapshot().entries[0].state, 'queued');
    await assert.rejects(library.mutate(draft => library.protection.unlock(draft, target.id, 'first-password')), /password/i);
    await library.mutate(draft => library.protection.unlock(draft, target.id, 'second-password'));
    receiver.pump(); await until(() => receiver.snapshot().entries[0].state === 'saved');
  } finally { await receiver?.stop(); library.protection.clear(); await rm(root, { recursive: true, force: true }); }
});

test('phone browsing is opt-in, open-only, password scoped, and selected destinations survive retries', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-phone-boards-')), library = await openLibrary(root);
  const open = newCollection('Open'), protectedBoard = newCollection('Protected'), closed = { ...newCollection('Closed'), closed: true };
  const folder = randomUUID(), itemId = randomUUID(), pin = { id: randomUUID(), collectionId: protectedBoard.id, title: 'secret title', sourceUrl: 'https://example.com/secret',
    notes: 'secret notes', tags: [], engine: 'page', offline: true, folder, coverId: itemId, createdAt: new Date().toISOString(),
    items: [{ id: itemId, kind: 'image', url: 'https://example.com/secret.png', previewFile: `${folder}/preview.png`, localFile: `${folder}/original.png` }] };
  await mkdir(path.join(root, 'media', folder)); const bytes = Buffer.alloc(16 * 1024 * 1024, 73); Buffer.from('0123456789abcdef').copy(bytes);
  await writeFile(path.join(root, 'media', pin.items[0].previewFile), bytes); await writeFile(path.join(root, 'media', pin.items[0].localFile), bytes);
  await library.mutate(draft => { draft.collections.push(open, protectedBoard, closed); draft.pins.push(pin); });
  await library.mutate(draft => library.protection.setPassword(draft, protectedBoard.id, 'phone-password'));
  const chosenPort = await port(), endpoint = `http://127.0.0.1:${chosenPort}`, deliveries = [];
  const options = { addresses, library, collection: (id, unlocked = true) => unlocked ? library.requireUnlocked(id) : library.snapshot().collections.find(c => c.id === id),
    unlock: (id, password) => library.mutate(draft => library.protection.unlock(draft, id, password)),
    codec: { encode: (task, data) => library.protection.encodeTask(task, data || library.snapshot()), decode: task => library.protection.decodeTask(task) },
    run: async task => { deliveries.push(task.payload.collectionId); return {}; } };
  let receiver = await openPhoneReceiver(root, options);
  t.after(async () => { await receiver.stop(); library.protection.clear(); await rm(root, { recursive: true, force: true }); });
  const settings = { enabled: true, host: '127.0.0.1', port: chosenPort, collectionId: open.id };
  await receiver.configure(settings); const first = await pair(receiver, endpoint), second = await pair(receiver, endpoint);
  const call = (device, route, body, headers = {}) => fetch(endpoint + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + device.token, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const boardRoute = '/v1/collections/' + protectedBoard.id;
  assert.equal((await call(first, '/v1/capabilities')).status, 200);
  assert.equal((await (await call(first, '/v1/capabilities')).json()).collections, false);
  assert.equal((await call(first, '/v1/collections')).status, 403);
  assert.equal((await call(first, '/v1/shares', { id: randomUUID(), url: 'https://example.com/a', collectionId: open.id })).status, 403);
  await receiver.configure({ ...settings, browsing: true });
  assert.equal((await (await call(first, '/v1/capabilities')).json()).selectedDestination, true);
  const list = await (await call(first, '/v1/collections')).json();
  assert.deepEqual(list.collections.map(c => c.id), [open.id, protectedBoard.id]);
  assert.equal(list.collections[1].locked, true, 'desktop-unlocked collection still requires the phone password');
  assert.equal(JSON.stringify(list).includes('secret'), false);
  assert.equal((await call(first, boardRoute + '/pins')).status, 423);
  assert.equal((await call(first, '/v1/collections/' + closed.id + '/pins')).status, 404);
  assert.equal((await call(first, boardRoute + '/unlock', { password: 'incorrect' })).status, 423);
  assert.equal((await call(first, boardRoute + '/unlock', { password: 'phone-password' })).status, 200);
  const page = await (await call(first, boardRoute + '/pins?limit=1')).json();
  assert.equal(page.pins[0].title, 'secret title'); assert.equal(page.nextOffset, null);
  assert.equal((await (await call(first, boardRoute + '/pins?q=secret')).json()).pins.length, 1);
  assert.equal((await (await call(first, boardRoute + '/pins?q=absent')).json()).pins.length, 0);
  for (const value of ['vault', 'localFile', 'previewFile', root]) assert.equal(JSON.stringify(page).includes(value), false);
  assert.equal((await call(second, boardRoute + '/pins')).status, 423);
  const mediaUrl = page.pins[0].items[0].previewUrl;
  assert.equal((await fetch(mediaUrl)).status, 401);
  assert.equal((await fetch(mediaUrl, { headers: { Authorization: 'Bearer ' + second.token } })).status, 423);
  const media = await fetch(mediaUrl, { headers: { Authorization: 'Bearer ' + first.token, Range: 'bytes=2-6' } });
  assert.equal(media.status, 206); assert.equal(await media.text(), '23456'); assert.equal(media.headers.get('cache-control'), 'no-store');
  assert.equal((await call(first, boardRoute + '/pins?limit=51')).status, 400);
  assert.equal((await call(first, '/v1/collections', undefined, { Origin: 'https://hostile.example' })).status, 403);
  const id = randomUUID(), submission = { id, url: 'https://example.com/chosen', collectionId: protectedBoard.id };
  assert.equal((await call(first, '/v1/shares', submission)).status, 202);
  await until(() => receiver.snapshot().entries.find(e => e.collectionId === protectedBoard.id)?.state === 'saved');
  assert.deepEqual(deliveries, [protectedBoard.id]);
  assert.equal((await call(first, '/v1/shares', { ...submission, collectionId: open.id })).status, 409);
  const active = await fetch(page.pins[0].items[0].originalUrl, { headers: { Authorization: 'Bearer ' + first.token } }), reader = active.body.getReader();
  assert.ok((await reader.read()).value.length > 0); global.gc?.();
  await library.mutate(draft => library.protection.lock(draft, protectedBoard.id));
  await assert.rejects(async () => { while (!(await reader.read()).done) {} }, /terminated|abort|socket/i, 'locking cancels an active encrypted transfer even after the request is collected');
  assert.equal((await call(first, boardRoute + '/pins')).status, 423);
  assert.equal((await call(first, '/v1/shares', submission)).status, 200, 'accepted receipt remains readable while locked');
  assert.equal((await call(first, '/v1/shares', { ...submission, id: randomUUID() })).status, 423);
  assert.equal((await call(first, boardRoute + '/unlock', { password: 'phone-password' })).status, 200);
  await call(first, '/v1/access/clear', {});
  assert.equal((await call(first, boardRoute + '/pins')).status, 423);
  await call(first, boardRoute + '/unlock', { password: 'phone-password' });
  await receiver.stop(); receiver = await openPhoneReceiver(root, options);
  assert.equal(receiver.snapshot().browsing, true);
  assert.equal((await call(first, boardRoute + '/pins')).status, 423, 'restart discards phone password grants');
  assert.equal((await call(first, '/v1/shares', submission)).status, 200);
  await call(first, boardRoute + '/unlock', { password: 'phone-password' });
  await library.mutate(draft => { draft.collections.find(c => c.id === protectedBoard.id).closed = true; });
  assert.equal((await call(first, boardRoute + '/pins')).status, 404);
  await receiver.revoke(first.deviceId);
  assert.equal((await call(first, '/v1/collections')).status, 401);
  const largePins = Array.from({ length: 15 }, (_, index) => { const itemId = randomUUID(); return { id: randomUUID(), collectionId: open.id, sourceUrl: `https://example.com/large/${index}`, title: 'Large text', notes: '', tags: [], engine: 'page', offline: false, text: '文'.repeat(20000), coverId: itemId, items: [{ id: itemId, kind: 'text', text: '文'.repeat(20000) }] }; });
  await library.mutate(draft => draft.pins.push(...largePins));
  const seen = []; let offset = 0;
  do { const page = await (await call(second, `/v1/collections/${open.id}/pins?offset=${offset}`)).json(); assert.ok(Buffer.byteLength(JSON.stringify(page)) < 1024 * 1024 + 1024); assert.ok(page.pins.every(pin => pin.textTruncated)); seen.push(...page.pins.map(pin => pin.id)); offset = page.nextOffset; } while (offset !== null);
  assert.equal(new Set(seen).size, largePins.length);
  assert.equal(library.snapshot().pins.find(pin => pin.id === largePins[0].id).text.length, 20000, 'phone snippets preserve the full desktop text');
  const stored = await readFile(path.join(root, 'phone-receiver.json'), 'utf8');
  for (const secret of ['phone-password', first.token, 'example.com/chosen']) assert.equal(stored.includes(secret), false);
});
