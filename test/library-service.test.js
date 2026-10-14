import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { get } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { openLibrary, newCollection } from '../src/library.js';
import { openLibraryService } from '../src/library-service.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'papan-apps-'));
  let library = await openLibrary(root), service;
  const collections = [newCollection('Shared'), newCollection('Private')], bytes = Buffer.alloc(2 * 1024 * 1024 + 77);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const pins = collections.map((collection, index) => {
    const folder = randomUUID(), id = randomUUID();
    return { id: randomUUID(), collectionId: collection.id, title: index ? 'hidden secret' : '画面 study', notes: index ? 'private notes' : 'blue hour', tags: ['two words', '日本語'],
      sourceUrl: 'https://www.example.com/' + index, engine: 'page', folder, offline: true, coverId: id, createdAt: new Date().toISOString(),
      items: [{ id, kind: index ? 'video' : 'image', url: 'https://example.com/file', localFile: `${folder}/original.mp4`, previewFile: `${folder}/preview.webp` },
        { id: randomUUID(), kind: 'text', text: index ? 'private text' : 'article body searchable' }] };
  });
  for (const pin of pins) {
    await mkdir(path.join(root, 'media', pin.folder));
    await writeFile(path.join(root, 'media', pin.items[0].localFile), bytes);
    await writeFile(path.join(root, 'media', pin.items[0].previewFile), bytes.subarray(0, 100));
  }
  await library.mutate(draft => { draft.collections.push(...collections); draft.pins.push(...pins); });
  service = await openLibraryService(root, { library, port: 0 });
  t.after(async () => { await service.stop(); library.protection.clear(); await rm(root, { recursive: true, force: true }); });
  const request = (connection, route, options = {}) => fetch(connection.endpoint + route, {
    ...options, headers: { Authorization: 'Bearer ' + connection.token, ...options.headers },
  });
  return { root, collections, pins, bytes, request, get library() { return library; }, get service() { return service; },
    async start() { await service.configure({ enabled: true, port: 0 }); },
    async restart() { await service.stop(); library.protection.clear(); library = await openLibrary(root); service = await openLibraryService(root, { library }); },
  };
}
async function until(check, detail = () => '') {
  for (let i = 0; i < 300; i++) { if (await check()) return; await delay(10); }
  assert.fail('Expected local client state was not reached. ' + detail());
}
async function events(f, connection, lastId) {
  const controller = new AbortController(), received = [];
  const response = await f.request(connection, '/v1/events', { signal: controller.signal, headers: lastId ? { 'Last-Event-ID': lastId } : {} });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(); let buffer = '', closed = false;
  const reading = (async () => {
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        buffer += new TextDecoder().decode(next.value);
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = chunk.split('\n').find(line => line.startsWith('data: '));
          if (data) received.push({ name: chunk.split('\n').find(line => line.startsWith('event: ')).slice(7), ...JSON.parse(data.slice(6)) });
        }
      }
    } catch (error) { if (!controller.signal.aborted) throw error; }
    finally { closed = true; }
  })();
  await until(() => received.length);
  return { received, get closed() { return closed; }, async close() { controller.abort(); await reading; } };
}

test('local library clients browse and search only granted content, stream ranges, and cannot write or discover paths', async t => {
  const f = await fixture(t); assert.equal(f.service.snapshot().running, false); await f.start();
  const connection = await f.service.grant({ name: 'Any app', collectionIds: [f.collections[0].id] });
  assert.equal((await fetch(connection.endpoint + '/v1')).status, 200);
  assert.equal((await fetch(connection.endpoint + '/v1/pins')).status, 401);
  assert.equal((await f.request({ ...connection, token: 'x'.repeat(43) }, '/v1/pins')).status, 401);
  assert.equal((await f.request(connection, '/v1/pins', { headers: { Origin: 'https://hostile.example' } })).status, 403);
  assert.equal(await new Promise((resolve, reject) => get(connection.endpoint + '/v1/pins', { headers: { Host: 'hostile.example', Authorization: 'Bearer ' + connection.token } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject)), 403);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal((await f.request(connection, '/v1/pins', { method })).status, 405);
  const page = await (await f.request(connection, '/v1/pins')).json();
  assert.equal(page.total, 1); assert.equal(page.items[0].title, '画面 study');
  for (const secret of [f.root, 'localFile', 'previewFile', 'vault', 'private notes', 'hidden secret', 'file://']) assert.equal(JSON.stringify(page).includes(secret), false, secret);
  assert.deepEqual(page.items[0].tags, ['two words', '日本語']);
  for (const filter of ['q=article', 'q=BLUE%20HOUR', 'tag=two%20words', 'tag=' + encodeURIComponent('日本語'), 'kind=text', 'source=example.com']) {
    assert.equal((await (await f.request(connection, '/v1/search?' + filter)).json()).total, 1, filter);
  }
  assert.equal((await (await f.request(connection, '/v1/search?kind=video')).json()).total, 0);
  assert.equal((await f.request(connection, '/v1/pins?collectionId=' + f.collections[1].id)).status, 404);
  assert.equal((await (await f.request(connection, '/v1/collections')).json()).items.length, 1);
  assert.equal((await f.request(connection, '/v1/pins?limit=201')).status, 400);
  assert.equal((await f.request(connection, '/v1/pins?offset=-1')).status, 400);
  assert.equal((await (await f.request(connection, '/v1/pins?offset=1&limit=1')).json()).items.length, 0);
  const item = page.items[0].items[0], route = new URL(item.originalUrl).pathname;
  let response = await f.request(connection, route, { headers: { Range: 'bytes=1048570-1048610' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes.subarray(1048570, 1048611));
  response = await f.request(connection, route, { method: 'HEAD' });
  assert.equal(response.headers.get('content-length'), String(f.bytes.length)); assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal((await f.request(connection, route, { headers: { Range: 'bytes=999999999-' } })).status, 416);
  assert.equal((await f.request(connection, route + '?variant=unknown')).status, 400);
  assert.equal((await f.request(connection, `/v1/pins/${f.pins[1].id}/items/${f.pins[1].items[0].id}/media`)).status, 404);
  response = await f.request(connection, new URL(item.previewUrl).pathname + '?variant=preview');
  assert.equal(response.headers.get('content-type'), 'image/webp'); assert.equal((await response.arrayBuffer()).byteLength, 100);
  const config = await readFile(path.join(f.root, 'library-service.json'), 'utf8');
  assert.equal(config.includes(connection.token), false); assert.equal(JSON.stringify(f.service.snapshot()).includes('keyHash'), false);
  if (process.platform !== 'win32') assert.equal((await stat(path.join(f.root, 'library-service.json'))).mode & 0o777, 0o600);
});

test('changes have per-app revisions, reconnect cursors, durable grants, and revocation closes subscriptions', async t => {
  const f = await fixture(t); await f.start();
  let connection = await f.service.grant({ name: 'Subscriber', collectionIds: [f.collections[0].id] });
  let subscription = await events(f, connection); t.after(() => subscription.close());
  const first = subscription.received[0].revision; assert.equal(subscription.received[0].reset, true);
  await f.library.mutate(draft => { draft.pins[1].title = 'ungranted change'; });
  const unchanged = await (await f.request(connection, '/v1/pins')).json(); assert.equal(unchanged.revision, first);
  assert.equal(subscription.received.length, 1);
  await assert.rejects(f.library.mutate(draft => { draft.pins[0].title = 'failed change'; throw new Error('rollback'); }), /rollback/);
  assert.equal((await (await f.request(connection, '/v1/pins')).json()).revision, first);
  await f.library.mutate(draft => { draft.pins[0].notes = 'committed edit'; });
  await until(() => subscription.received.length === 2);
  assert.equal(subscription.received[1].name, 'change'); assert.notEqual(subscription.received[1].revision, first);
  assert.equal(JSON.stringify(subscription.received).includes('committed edit'), false);
  await f.library.mutate(draft => { draft.pins[0].items[0].previewVersion = 2; });
  await until(() => subscription.received.length === 3);
  const cursor = subscription.received[2].revision;
  await subscription.close(); subscription = await events(f, connection, cursor); assert.equal(subscription.received[0].reset, false);
  await subscription.close(); await f.restart(); connection = { ...connection, endpoint: f.service.snapshot().endpoint };
  assert.equal((await f.request(connection, '/v1/pins')).status, 200);
  subscription = await events(f, connection, cursor); assert.equal(subscription.received[0].reset, true);
  await f.service.updateClient({ id: connection.clientId, name: 'Subscriber', collectionIds: [f.collections[1].id] });
  await until(() => subscription.received.length === 2);
  assert.equal((await (await f.request(connection, '/v1/pins')).json()).items[0].title, 'ungranted change');
  await f.service.revoke(connection.clientId); await until(() => subscription.closed);
  assert.equal((await f.request(connection, '/v1/pins')).status, 401);
  assert.throws(() => f.service.connection(connection), /no longer/);
});

test('protected media remains encrypted, hides on lock/restart, and lock/revoke/scope changes cancel active decryption', async t => {
  const f = await fixture(t), target = f.collections[1], password = 'private password 🔑';
  await f.library.mutate(draft => f.library.protection.setPassword(draft, target.id, password));
  await f.start();
  const connection = await f.service.grant({ name: 'Protected reader', collectionIds: [target.id] });
  const unrelated = await f.service.grant({ name: 'Unrelated reader', collectionIds: [f.collections[0].id] });
  const unrelatedRevision = (await (await f.request(unrelated, '/v1/pins')).json()).revision;
  const route = `/v1/pins/${f.pins[1].id}/items/${f.pins[1].items[0].id}/media`;
  let response = await f.request(connection, route, { headers: { Range: 'bytes=1048560-1048600' } });
  assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes.subarray(1048560, 1048601));
  await assert.rejects(readFile(path.join(f.root, 'media', f.pins[1].items[0].localFile)), { code: 'ENOENT' });
  const media = f.library.protection.media.bind(f.library.protection);
  let finished = 0;
  const streamSignals = [];
  f.library.protection.media = (...args) => {
    const descriptor = media(...args);
    return descriptor && { ...descriptor, async *stream(start, end, signal) {
      streamSignals.push(signal);
      try { for await (const chunk of descriptor.stream(start, end, signal)) { yield chunk; await delay(10000, undefined, { signal }); } }
      finally { finished++; }
    } };
  };
  async function interrupted(action) {
    const response = await f.request(connection, route);
    assert.equal(response.status, 200);
    const body = response.arrayBuffer().then(() => 'completed', () => 'cancelled');
    await action(); assert.equal(await body, 'cancelled');
  }
  await interrupted(() => f.library.mutate(draft => f.library.protection.lock(draft, target.id)));
  assert.equal((await (await f.request(connection, '/v1/pins')).json()).total, 0);
  assert.equal((await (await f.request(connection, '/v1/collections')).json()).items[0].locked, true);
  assert.equal((await f.request(connection, '/v1/search?collectionId=' + target.id)).status, 423);
  assert.equal((await f.request(connection, route)).status, 404);
  await assert.rejects(f.service.grant({ name: 'Locked reader', collectionIds: [target.id] }), /Unlock/);
  await assert.rejects(f.library.mutate(draft => f.library.protection.unlock(draft, target.id, 'wrong')), /password/);
  await f.library.mutate(draft => f.library.protection.unlock(draft, target.id, password));
  await interrupted(async () => {
    f.service.suspend(target.id); f.service.suspend(target.id); f.service.resume(target.id);
    assert.equal((await f.request(connection, '/v1/pins')).status, 503);
    assert.equal((await (await f.request(unrelated, '/v1/pins')).json()).revision, unrelatedRevision);
    f.service.resume(target.id);
  });
  await interrupted(() => f.service.updateClient({ id: connection.clientId, name: 'Protected reader', collectionIds: [f.collections[0].id] }));
  await f.service.updateClient({ id: connection.clientId, name: 'Protected reader', collectionIds: [target.id] });
  await interrupted(() => f.service.revoke(connection.clientId));
  await until(() => finished === 4, () => 'Closed generators: ' + finished);
  assert.equal(streamSignals.length, 4);
  assert.ok(streamSignals.every(signal => signal.aborted), 'every interrupted reader receives cancellation');
  const persistent = await f.service.grant({ name: 'Restart reader', collectionIds: [target.id] });
  await f.restart(); persistent.endpoint = f.service.snapshot().endpoint;
  assert.equal((await (await f.request(persistent, '/v1/pins')).json()).total, 0);
  await f.library.mutate(draft => f.library.protection.unlock(draft, target.id, password));
  assert.equal((await (await f.request(persistent, '/v1/search?q=private')).json()).total, 1);
  for (const file of ['library.json', 'library.previous.json', 'library-service.json']) {
    const text = await readFile(path.join(f.root, file), 'utf8');
    for (const secret of ['hidden secret', 'private notes', password, persistent.token]) assert.equal(text.includes(secret), false, file + ': ' + secret);
  }
});

test('settings failures preserve data, busy ports recover, and disable stops connected clients', async t => {
  const f = await fixture(t), blocker = createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  await f.service.configure({ enabled: true, port: blocker.address().port });
  assert.equal(f.service.snapshot().running, false); assert.match(f.service.snapshot().error, /already in use/);
  await f.start();
  const connection = await f.service.grant({ name: 'Client', collectionIds: [f.collections[0].id] });
  const subscription = await events(f, connection); t.after(() => subscription.close());
  await f.service.configure({ enabled: false, port: 0 }); await until(() => subscription.closed);
  assert.equal(f.service.snapshot().running, false);
  await assert.rejects(f.request(connection, '/v1/pins'));
  await f.service.stop(); await f.service.stop();
  const broken = '{"version": 99}'; await writeFile(path.join(f.root, 'library-service.json'), broken);
  await assert.rejects(openLibraryService(f.root, { library: f.library }), /preserved/);
  assert.equal(await readFile(path.join(f.root, 'library-service.json'), 'utf8'), broken);
});
