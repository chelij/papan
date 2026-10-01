import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
