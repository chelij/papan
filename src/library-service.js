import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { mediaLocation } from './collection-files.js';
import { fileResponse } from './file-response.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const sourceHost = value => { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const mediaTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.heic': 'image/heic', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.ts': 'video/mp2t' };

export async function openLibraryService(root, { library, publish = () => {}, port = 47779 }) {
  const settingsFile = path.join(root, 'library-service.json');
  let state = { version: 1, serverId: randomUUID(), enabled: false, port, clients: [] };
  try {
    const saved = JSON.parse(await readFile(settingsFile, 'utf8'));
    if (saved.version !== 1 || !uuid.test(saved.serverId) || typeof saved.enabled !== 'boolean' ||
        !Number.isInteger(saved.port) || saved.port < 0 || saved.port > 65535 || !Array.isArray(saved.clients) || saved.clients.length > 32 ||
        new Set(saved.clients.map(client => client.id)).size !== saved.clients.length ||
        saved.clients.some(client => !uuid.test(client.id) || typeof client.name !== 'string' || !client.name.trim() || client.name.length > 80 ||
          !/^[a-f0-9]{64}$/.test(client.keyHash) || !Array.isArray(client.collectionIds) || client.collectionIds.length > 1000 ||
          client.collectionIds.some(id => !uuid.test(id)) || new Set(client.collectionIds).size !== client.collectionIds.length)) throw new Error('Invalid app connection settings.');
    state = saved;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not read app connection settings. Your files were preserved. ' + error.message);
  }

  let server = null, error = '', stopped = false, writes = Promise.resolve();
  const suspensions = new Map();
  const suspended = id => suspensions.has(id);
  const appSuspended = client => client.collectionIds.some(suspended);
  const epoch = randomUUID(), revisions = new Map(), subscriptions = new Set(), streams = new Set();
  const endpoint = () => server?.listening ? 'http://127.0.0.1:' + server.address().port : '';
  const snapshot = () => ({ version: 1, enabled: state.enabled, running: Boolean(server?.listening), port: server?.listening ? server.address().port : state.port,
    endpoint: endpoint(), error, clients: state.clients.map(client => pick(client, ['id', 'name', 'collectionIds', 'createdAt'])) });
  const announce = () => { try { publish(snapshot()); } catch (failure) { console.error('App connection status notification failed:', failure.message); } };
  const getClient = id => state.clients.find(client => client.id === id);
  const hasOriginal = item => Boolean(item.localFile || item.localPath || item.vault?.original);
  const hasPreview = item => Boolean(item.previewFile || item.previewPath || item.vault?.preview || hasOriginal(item));
  const mediaUrl = (pin, item, variant) => endpoint() + '/v1/pins/' + pin.id + '/items/' + item.id + '/media?variant=' + variant;

  function view(client) {
    const data = library.snapshot(), granted = new Set(client.collectionIds);
    const collections = data.collections.filter(collection => granted.has(collection.id)).map(collection => ({
      id: collection.id, name: collection.name, createdAt: collection.createdAt,
      protected: Boolean(collection.vault), locked: Boolean(collection.vault && !library.protection.isUnlocked(collection.id)),
    }));
    const visible = new Set(collections.filter(collection => !collection.locked && !suspended(collection.id)).map(collection => collection.id));
    const savedPins = data.pins.filter(pin => visible.has(pin.collectionId));
    const pins = savedPins.map(pin => ({
      ...pick(pin, ['id', 'collectionId', 'title', 'notes', 'tags', 'sourceUrl', 'author', 'text', 'engine', 'createdAt', 'coverId', 'previews']),
      items: pin.items.map(item => ({
        ...pick(item, ['id', 'kind', 'width', 'height', 'previewWidth', 'previewHeight', 'duration', 'text', 'poseFor', 'poseOptions']),
        ...(hasPreview(item) ? { previewUrl: mediaUrl(pin, item, 'preview') } : {}),
        ...(hasOriginal(item) ? { originalUrl: mediaUrl(pin, item, 'original') } : {}),
      })),
    }));
    return { collections, pins, fingerprint: hash(JSON.stringify(savedPins)) };
  }

  function revision(client, visible = view(client)) {
    const fingerprint = hash(JSON.stringify({ suspended: client.collectionIds.filter(suspended), visible }));
    let record = revisions.get(client.id);
    if (!record || record.fingerprint !== fingerprint) {
      record = { fingerprint, sequence: (record?.sequence || 0) + 1 };
      revisions.set(client.id, record);
    }
    return epoch + ':' + record.sequence;
  }

  function stillAllowed(stream) {
    const client = getClient(stream.clientId), data = library.snapshot();
    const pin = data.pins.find(pin => pin.id === stream.pinId && pin.collectionId === stream.collectionId);
    return !suspended(stream.collectionId) && !stopped && client?.collectionIds.includes(stream.collectionId) &&
      data.collections.some(collection => collection.id === stream.collectionId && (!collection.vault || library.protection.isUnlocked(collection.id))) &&
      pin?.items.some(item => item.id === stream.itemId);
  }

  function abortStream(stream) { stream.controller.abort(); stream.response.destroy(); }
  function event(subscription, name, value, id) {
    if (!subscription.response.write((id ? 'id: ' + id + '\n' : '') + 'event: ' + name + '\ndata: ' + JSON.stringify(value) + '\n\n')) subscription.response.destroy();
  }

  function notify() {
    for (const stream of streams) if (!stillAllowed(stream)) abortStream(stream);
    for (const subscription of subscriptions) {
      const client = getClient(subscription.clientId);
      if (!client) { subscription.response.end(); continue; }
      const next = revision(client);
      if (next !== subscription.revision) {
        subscription.revision = next;
        event(subscription, 'change', { revision: next, reset: true }, next);
      }
    }
  }
  const unsubscribe = library.subscribe(notify);

  async function persist(next) {
    const temporary = settingsFile + '.' + randomUUID() + '.tmp';
    try { await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 }); await rename(temporary, settingsFile); }
    finally { await rm(temporary, { force: true }); }
    state = next;
  }
  function change(operation, after = () => {}) {
    const next = writes.then(async () => {
      if (stopped) throw new Error('App connections have stopped.');
      const draft = structuredClone(state), result = await operation(draft);
      await persist(draft); await after(); notify(); announce(); return result;
    });
    writes = next.catch(() => {});
    return next;
  }
  function clientInput(input, previous) {
    if (typeof input?.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw new Error('Enter an app name of up to 80 characters.');
    if (!Array.isArray(input.collectionIds) || !input.collectionIds.length || input.collectionIds.length > 1000 ||
        input.collectionIds.some(id => !uuid.test(id)) || new Set(input.collectionIds).size !== input.collectionIds.length) throw new Error('Choose at least one collection.');
    const data = library.snapshot();
    for (const id of input.collectionIds) {
      const collection = data.collections.find(collection => collection.id === id);
      if (!collection) throw new Error('A chosen collection is no longer available.');
      if (!previous?.collectionIds.includes(id)) library.requireUnlocked(id, data);
    }
    return { name: input.name.trim(), collectionIds: [...input.collectionIds] };
  }

  function authenticate(request) {
    const authorization = request.headers.authorization || '';
    if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw failure('An app access key is required.', 401);
    const digest = Buffer.from(hash(authorization.slice(7)), 'hex');
    const client = state.clients.find(client => timingSafeEqual(Buffer.from(client.keyHash, 'hex'), digest));
    if (!client) throw failure('App access was revoked or the key is invalid.', 401);
    return client;
  }
  function send(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close' });
    response.end(JSON.stringify(value));
  }
  function page(items, parameters, currentRevision) {
    const integer = (name, fallback, maximum) => {
      const value = parameters.get(name);
      if (value !== null && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum)) throw failure('Invalid ' + name + '.');
      return value === null ? fallback : Number(value);
    };
    const offset = integer('offset', 0, Number.MAX_SAFE_INTEGER), limit = integer('limit', 50, 200);
    if (!limit) throw failure('Limit must be between 1 and 200.');
    return { version: 1, revision: currentRevision, items: items.slice(offset, offset + limit), total: items.length,
      nextOffset: offset + limit < items.length ? offset + limit : null };
  }

  async function receive(request, response) {
    try {
      if (request.headers.host !== endpoint().slice(7) || request.headers.origin !== undefined) throw failure('Untrusted request.', 403);
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('Allow', 'GET, HEAD'); throw failure('This service is read only.', 405); }
      const url = new URL(request.url, endpoint());
      if (url.origin !== endpoint()) throw failure('Untrusted request.', 403);
      if (url.pathname === '/v1') return send(response, 200, { service: 'papan-library', version: 1, serverId: state.serverId,
        capabilities: ['collections', 'pins', 'search', 'media', 'events', 'protected-collections'] });
      const client = authenticate(request);
      if (appSuspended(client) || stopped) throw failure('Collection protection is changing. Retry shortly.', 503);

      if (url.pathname === '/v1/events') {
        if (request.method !== 'GET') throw failure('Events require GET.', 405);
        if (subscriptions.size >= 64 || [...subscriptions].filter(item => item.clientId === client.id).length >= 4) throw failure('Too many event connections.', 429);
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' });
        const current = revision(client), subscription = { clientId: client.id, response, revision: current };
        subscriptions.add(subscription);
        const heartbeat = setInterval(() => { if (!response.write(': heartbeat\n\n')) response.destroy(); }, 15000);
        heartbeat.unref();
        response.once('close', () => { clearInterval(heartbeat); subscriptions.delete(subscription); });
        event(subscription, 'ready', { revision: current, reset: request.headers['last-event-id'] !== current }, current);
        return;
      }

      const media = /^\/v1\/pins\/([0-9a-f-]{36})\/items\/([0-9a-f-]{36})\/media$/i.exec(url.pathname);
      if (media) {
        const variant = url.searchParams.get('variant') || 'original';
        if (!['original', 'preview'].includes(variant)) throw failure('Choose original or preview media.');
        const data = library.snapshot(), pin = data.pins.find(pin => pin.id === media[1] && client.collectionIds.includes(pin.collectionId));
        const collection = data.collections.find(collection => collection.id === pin?.collectionId);
        if (collection?.vault && !library.protection.isUnlocked(collection.id)) throw failure('Unlock this collection in Papan first.', 423);
        const item = pin?.items.find(item => item.id === media[2]);
        if (!item || !(variant === 'original' ? hasOriginal(item) : hasPreview(item))) throw failure('Saved media is not available.', 404);
        const controller = new AbortController(), stream = { clientId: client.id, collectionId: pin.collectionId, pinId: pin.id, itemId: item.id, controller, response };
        streams.add(stream);
        response.once('close', () => { controller.abort(); streams.delete(stream); });
        try {
          const file = library.protection.media(item, variant === 'original') || mediaLocation(root, item, variant === 'original');
          if (!file) throw failure('Saved media is not available.', 404);
          const extension = typeof file === 'string' ? path.extname(file).toLowerCase() : file.ext;
          const result = await fileResponse(file, { method: request.method, headers: new Headers(request.headers), signal: controller.signal }, mediaTypes[extension] || 'application/octet-stream');
          if (!stillAllowed(stream) || controller.signal.aborted) return abortStream(stream);
          const headers = Object.fromEntries(result.headers);
          headers['cache-control'] = 'no-store';
          response.writeHead(result.status, headers);
          if (result.body) {
            const body = Readable.fromWeb(result.body);
            body.on('error', () => response.destroy());
            response.once('close', () => body.destroy());
            body.pipe(response);
          } else response.end();
        } catch (error) {
          if (controller.signal.aborted || response.destroyed) return;
          throw failure('Saved media could not be read.', error.status || 404);
        }
        return;
      }

      const visible = view(client), current = revision(client, visible);
      if (url.pathname === '/v1/collections') return send(response, 200, page(visible.collections, url.searchParams, current));
      if (url.pathname === '/v1/pins' || url.pathname === '/v1/search') {
        const collectionId = url.searchParams.get('collectionId'), kind = url.searchParams.get('kind') || '';
        const query = (url.searchParams.get('q') || '').trim().toLowerCase(), tag = (url.searchParams.get('tag') || '').toLowerCase(), source = (url.searchParams.get('source') || '').toLowerCase();
        if (query.length > 500 || tag.length > 40 || source.length > 253 || !['', 'image', 'video', 'text'].includes(kind)) throw failure('Invalid search filter.');
        if (collectionId) {
          const collection = visible.collections.find(collection => collection.id === collectionId);
          if (!collection) throw failure('Collection not available to this app.', 404);
          if (collection.locked) throw failure('Unlock this collection in Papan first.', 423);
        }
        const pins = visible.pins.filter(pin => (!collectionId || pin.collectionId === collectionId) &&
          (!query || [pin.title, pin.author, pin.text, pin.sourceUrl, pin.notes, ...(pin.tags || []), ...pin.items.filter(item => item.kind === 'text').map(item => item.text)].join(' ').toLowerCase().includes(query)) &&
          (!kind || pin.items.some(item => item.kind === kind)) &&
          (!tag || pin.tags?.some(value => value.toLowerCase() === tag)) &&
          (!source || sourceHost(pin.sourceUrl) === source.replace(/^www\./, '')));
        return send(response, 200, page(pins, url.searchParams, current));
      }
      throw failure('Not found.', 404);
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) response.destroy();
      else send(response, error.status || 500, { error: error.status ? error.message : 'The library request failed.' });
    }
  }

  async function closeServer() {
    for (const stream of streams) abortStream(stream);
    for (const subscription of subscriptions) subscription.response.end();
    const closing = server; server = null;
    if (closing) await new Promise(resolve => { closing.close(resolve); closing.closeAllConnections(); });
  }
  async function listen() {
    error = '';
    if (!state.enabled) return;
    const opening = createServer((request, response) => { void receive(request, response); });
    opening.requestTimeout = 10000; opening.headersTimeout = 5000;
    opening.on('error', value => { error = value.code === 'EADDRINUSE' ? 'That port is already in use. Choose another port.' : 'App connections could not start.'; announce(); });
    try {
      await new Promise((resolve, reject) => { opening.once('error', reject); opening.listen(state.port, '127.0.0.1', resolve); });
      server = opening;
    } catch { opening.close(); }
  }
  await listen();

  return {
    snapshot, notify,
    suspend(id) { suspensions.set(id, (suspensions.get(id) || 0) + 1); notify(); },
    resume(id) { const count = suspensions.get(id) || 0; if (count > 1) suspensions.set(id, count - 1); else suspensions.delete(id); notify(); },
    async configure(input) {
      if (typeof input?.enabled !== 'boolean' || !Number.isInteger(input.port) || input.port < 0 || input.port > 65535) throw new Error('Choose a valid port.');
      await change(draft => { draft.enabled = input.enabled; draft.port = input.port; }, async () => { await closeServer(); await listen(); });
      return snapshot();
    },
    async grant(input) {
      const token = randomBytes(32).toString('base64url'), id = randomUUID();
      await change(draft => {
        if (!server?.listening) throw new Error('Enable app connections first.');
        const chosen = clientInput(input);
        if (chosen.collectionIds.some(suspended)) throw new Error('Wait for the collection protection change to finish.');
        if (draft.clients.length >= 32) throw new Error('Revoke an app before adding another.');
        draft.clients.push({ ...chosen, id, keyHash: hash(token), createdAt: new Date().toISOString() });
      });
      return { version: 1, clientId: id, endpoint: endpoint(), token };
    },
    async updateClient(input) {
      await change(draft => {
        const index = draft.clients.findIndex(client => client.id === input?.id);
        if (index === -1) throw new Error('This app is no longer connected.');
        const chosen = clientInput(input, draft.clients[index]);
        if (chosen.collectionIds.some(suspended)) throw new Error('Wait for the collection protection change to finish.');
        draft.clients[index] = { ...draft.clients[index], ...chosen };
      });
      return snapshot();
    },
    async revoke(id) {
      await change(draft => { draft.clients = draft.clients.filter(client => client.id !== id); });
      revisions.delete(id);
      return snapshot();
    },
    connection(input) {
      const client = getClient(input?.clientId);
      if (!client || !tokenPattern.test(input?.token) || !timingSafeEqual(Buffer.from(client.keyHash, 'hex'), Buffer.from(hash(input.token), 'hex'))) throw new Error('This connection is no longer available.');
      if (!endpoint()) throw new Error('Enable app connections first.');
      return { version: 1, endpoint: endpoint(), token: input.token };
    },
    async stop() { stopped = true; unsubscribe(); await writes; await closeServer(); },
  };
}
