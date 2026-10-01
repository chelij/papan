import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { webURL } from './media.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shareId = /^[A-Za-z0-9_-]{8,100}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const captureId = (device, id) => {
  const hex = hash(`${device}:${id}`).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export function localAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, entries]) => entries
    .filter(item => !item.internal && item.family === 'IPv4' && privateAddress(item.address))
    .map(item => ({ name, address: item.address })));
}
export function privateAddress(address) {
  if (typeof address !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false;
  const parts = address.split('.').map(Number);
  return parts.every(n => n <= 255) && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const pairingPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pair with Papan</title><h1>Pair with Papan</h1><p>Install the Papan Android companion, then open it below. Pair only on a trusted local network: this connection uses HTTP.</p><p><a id="open">Open Papan companion</a></p><p>If your camera cannot open the link, paste this page's complete address into the companion's pairing field.</p><script src="/pair.js"></script></html>`;
const pairingScript = `const code=location.hash.slice(1);if(/^[a-f0-9]{32}$/.test(code))document.getElementById('open').href='papan-pair://connect?endpoint='+encodeURIComponent(location.origin)+'&code='+code;else document.getElementById('open').textContent='Pairing link is missing its code. Generate another QR in Papan.';`;

export async function openPhoneReceiver(root, { run, collection, publish = () => {}, addresses = localAddresses,
  codec = { encode: task => task, decode: task => task }, available = () => true }) {
  const file = path.join(root, 'phone-receiver.json');
  let state = { version: 1, serverId: randomUUID(), enabled: false, host: '', port: 47778, collectionId: '', devices: [], entries: [] };
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (saved.version !== 1 || !uuid.test(saved.serverId) || typeof saved.enabled !== 'boolean' || !Number.isInteger(saved.port) || saved.port < 1024 || saved.port > 65535 || typeof saved.host !== 'string' || typeof saved.collectionId !== 'string' || !Array.isArray(saved.devices) || saved.devices.length > 20 || !Array.isArray(saved.entries) || saved.entries.length > 5000 ||
      saved.devices.some(d => !uuid.test(d.id) || typeof d.name !== 'string' || !/^[a-f0-9]{64}$/.test(d.keyHash)) ||
      saved.entries.some(e => !uuid.test(e.id) || !['queued', 'running', 'failed', 'saved'].includes(e.state) || e.kind !== 'capture' || (!e.payload && !e.encrypted))) throw new Error('Invalid phone inbox.');
    state = saved;
    state.entries = state.entries.map(entry => entry.state === 'running' ? { ...entry, state: 'queued' } : entry);
  } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Could not read the phone inbox. Your files were preserved. ${error.message}`); }
  let server = null, networkError = '', writes = Promise.resolve(), active = null, stopped = false, pairing = null;
  let pairWindow = 0, pairAttempts = 0;
  const snapshot = () => ({ enabled: state.enabled, running: Boolean(server?.listening), host: state.host, port: state.port,
    collectionId: state.collectionId, addresses: addresses(), error: networkError, pairingExpiresAt: pairing?.expiresAt || null,
    devices: state.devices.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    entries: state.entries.map(stored => {
      const task = codec.decode(stored);
      return { id: task.id, state: task.state, collectionId: task.payload?.collectionId || task.collections?.[0],
        url: task.payload?.url, title: task.encrypted ? 'protected collection share' : task.payload?.url,
        error: task.error, progress: task.progress, createdAt: task.createdAt, locked: Boolean(task.encrypted) };
    }) });
  const announce = () => publish(snapshot());
  const persist = async (next, data, alreadyEncoded = false) => {
    const encoded = alreadyEncoded ? next : { ...next, entries: next.entries.map(task => codec.encode(task, data)) };
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(encoded, null, 2), { mode: 0o600 }); await rename(temporary, file); }
    finally { await rm(temporary, { force: true }); }
    state = encoded;
  };
  const mutate = action => {
    const next = writes.then(async () => {
      const draft = structuredClone(state), result = await action(draft);
      await persist(draft); announce(); return result;
    });
    writes = next.catch(() => {}); return next;
  };
  async function pump() {
    if (active || stopped || !available()) return;
    const task = state.entries.map(entry => codec.decode(entry)).find(entry => entry.state === 'queued' && !entry.encrypted);
    if (!task) return;
    const controller = new AbortController(); let finished;
    active = { id: task.id, controller, done: new Promise(resolve => { finished = resolve; }) };
    try {
      await mutate(draft => { draft.entries[draft.entries.findIndex(e => e.id === task.id)] = { ...task, state: 'running', error: '', progress: 'starting…' }; });
      controller.signal.throwIfAborted();
      const result = await run(task, controller.signal, progress => {
        void mutate(draft => { const index = draft.entries.findIndex(e => e.id === task.id); if (index !== -1) draft.entries[index] = { ...codec.decode(draft.entries[index]), progress: String(progress).slice(0, 300) }; }).catch(() => {});
      });
      await mutate(draft => { const index = draft.entries.findIndex(e => e.id === task.id); draft.entries[index] = { ...task, state: 'saved', result, progress: 'saved' }; });
    } catch (error) {
      // A commit may have succeeded before its receipt write failed. Retrying is
      // safe because savePhoneLink checks the stable pin ID and source URL.
      try { await mutate(draft => { const index = draft.entries.findIndex(e => e.id === task.id); draft.entries[index] = { ...codec.decode(draft.entries[index]), state: controller.signal.aborted ? 'queued' : 'failed', error: error.message }; }); }
      catch (failure) { networkError = `Phone inbox could not be saved: ${failure.message}`; announce(); }
    } finally { active = null; finished(); if (!stopped) void pump(); }
  }
  async function body(request) {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw fail('Send JSON.', 415);
    let length = 0, chunks = [];
    for await (const chunk of request) { length += chunk.length; if (length > 16384) throw fail('Request is too large.', 413); chunks.push(chunk); }
    try { const result = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result; }
    catch { throw fail('Invalid JSON.'); }
  }
  const receipt = (entry, id) => ({ id, state: entry.state, error: entry.error || '', received: true });
  async function receive(request, response) {
    const send = (status, value, type = 'application/json') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Connection': 'close',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      response.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    try {
      if (!state.enabled || request.headers.host !== `${state.host}:${state.port}` || request.headers.origin) throw fail('Untrusted request.', 403);
      const route = request.url;
      if (request.method === 'GET' && route === '/pair') return send(200, pairingPage, 'text/html; charset=utf-8');
      if (request.method === 'GET' && route === '/pair.js') return send(200, pairingScript, 'text/javascript');
      if (request.method === 'POST' && route === '/v1/pair') {
        if (Date.now() - pairWindow >= 60000) { pairWindow = Date.now(); pairAttempts = 0; }
        if (++pairAttempts > 20) throw fail('Too many pairing attempts. Wait a minute.', 429);
        const input = await body(request);
        const result = await mutate(draft => {
          if (!pairing || Date.now() >= pairing.expiresAt || typeof input.code !== 'string' || input.code !== pairing.code) throw fail('Pairing code expired or invalid. Generate another QR.', 401);
          if (draft.devices.length >= 20) throw fail('Remove a paired device first.', 409);
          if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw fail('Enter a device name.');
          const token = randomBytes(32).toString('base64url'), device = { id: randomUUID(), name: input.name.trim(), keyHash: hash(token), createdAt: new Date().toISOString() };
          draft.devices.push(device);
          pairing = null;
          return { version: 1, endpoint: `http://${draft.host}:${draft.port}`, token, deviceId: device.id, serverId: draft.serverId };
        });
        pairing = null; announce(); return send(201, result);
      }
      const authorization = request.headers.authorization || '';
      if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw fail('Pair this device with Papan first.', 401);
      const digest = Buffer.from(hash(authorization.slice(7)), 'hex');
      const device = state.devices.find(d => timingSafeEqual(Buffer.from(d.keyHash, 'hex'), digest));
      if (!device) throw fail('Pairing was revoked. Pair this device again.', 401);
      if (request.method === 'POST' && route === '/v1/shares') {
        const input = await body(request);
        if (typeof input.id !== 'string' || !shareId.test(input.id)) throw fail('A share needs a stable ID of 8–100 letters, digits, underscores, or hyphens.');
        const url = webURL(input.url), id = captureId(device.id, input.id);
        const result = await mutate(draft => {
          if (!draft.devices.some(d => d.id === device.id)) throw fail('Pairing was revoked.', 401);
          const found = draft.entries.find(e => e.id === id);
          if (found) {
            const decoded = codec.decode(found);
            if (decoded.payload && decoded.payload.url !== url) throw fail('This share ID already belongs to another link.', 409);
            return receipt(found, input.id);
          }
          if (!available()) throw fail('Papan is updating collection protection. Try again shortly.', 503);
          try { collection(draft.collectionId); } catch (error) { throw fail(error.message, 423); }
          if (draft.entries.length >= 5000 || draft.entries.filter(e => e.state !== 'saved').length >= 100) throw fail('Phone inbox is full. Resolve or dismiss entries in Papan first.', 429);
          const task = { id, kind: 'capture', state: 'queued', title: url, collections: [draft.collectionId],
            payload: { url, collectionId: draft.collectionId }, createdAt: new Date().toISOString() };
          draft.entries.push(task); return receipt(task, input.id);
        });
        void pump(); return send(result.state === 'saved' ? 200 : 202, result);
      }
      const match = route?.match(/^\/v1\/shares\/([A-Za-z0-9_-]{8,100})$/);
      if (request.method === 'GET' && match) {
        const entry = state.entries.find(e => e.id === captureId(device.id, match[1]));
        if (!entry) throw fail('Share receipt not found. Check the desktop collection.', 404);
        return send(200, receipt(entry, match[1]));
      }
      throw fail('Not found.', 404);
    } catch (error) { if (!response.headersSent) send(error.status || 400, { error: error.message }); else response.destroy(); }
  }
  async function closeServer() {
    pairing = null;
    if (server) { const closing = server; server = null; closing.closeAllConnections(); await new Promise(resolve => closing.close(resolve)); }
  }
  async function listen() {
    networkError = '';
    if (!state.enabled) return;
    try {
      if (!addresses().some(item => item.address === state.host)) throw new Error('The selected local address is unavailable. Choose your current network address.');
      const opening = createServer((request, response) => { void receive(request, response); });
      opening.requestTimeout = 10000; opening.headersTimeout = 10000; opening.maxHeadersCount = 32; opening.setTimeout(10000, socket => socket.destroy());
      await new Promise((resolve, reject) => { opening.once('error', reject); opening.listen(state.port, state.host, resolve); });
      opening.on('error', error => { networkError = error.message; announce(); }); server = opening;
    } catch (error) { networkError = `Could not receive from phone: ${error.message}`; }
  }
  await persist(state); await listen();
  return {
    snapshot, pump, get busy() { return Boolean(active); },
    async configure(input) {
      if (typeof input.enabled !== 'boolean' || typeof input.collectionId !== 'string' || typeof input.host !== 'string' || !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535 || input.enabled && !addresses().some(item => item.address === input.host)) throw fail('Choose a local network address and a port between 1024 and 65535.');
      if (input.enabled) collection(input.collectionId, false);
      await mutate(draft => Object.assign(draft, { enabled: input.enabled, host: input.host, port: input.port, collectionId: input.collectionId }));
      await closeServer(); await listen(); announce(); void pump(); return snapshot();
    },
    async pair() {
      if (!server?.listening) throw new Error('Enable the local receiver first.');
      pairing = { code: randomBytes(16).toString('hex'), expiresAt: Date.now() + 5 * 60000 };
      const url = `http://${state.host}:${state.port}/pair#${pairing.code}`;
      const qr = await QRCode.toDataURL(url, { width: 240, margin: 2, errorCorrectionLevel: 'M' });
      announce(); return { url, qr, expiresAt: pairing.expiresAt };
    },
    async revoke(id) { await mutate(draft => { draft.devices = draft.devices.filter(d => d.id !== id); }); },
    async retry(id) { await mutate(draft => { const index = draft.entries.findIndex(e => e.id === id), entry = index < 0 ? null : codec.decode(draft.entries[index]); if (!entry || entry.state !== 'failed') throw fail('Only failed shares can be retried.'); if (entry.encrypted) throw fail('Unlock the destination collection before retrying.'); draft.entries[index] = { ...entry, state: 'queued', error: '' }; }); void pump(); },
    async dismiss(id) { await mutate(draft => { const entry = draft.entries.find(e => e.id === id); if (!entry || entry.state === 'running' || entry.id === active?.id) throw fail('Wait for this share to finish first.'); draft.entries = draft.entries.filter(e => e.id !== id); }); },
    async clearSaved() { await mutate(draft => { draft.entries = draft.entries.filter(e => e.state !== 'saved'); }); },
    async recode(data) {
      await writes;
      const before = structuredClone(state);
      await persist(state, data);
      return async () => { await persist(before, undefined, true); };
    },
    async stop() { stopped = true; const saving = active; saving?.controller.abort(); await closeServer(); await saving?.done; await writes; },
  };
}
