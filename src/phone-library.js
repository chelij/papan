import { Readable } from 'node:stream';
import path from 'node:path';
import { mediaLocation } from './collection-files.js';
import { fileResponse } from './file-response.js';
import { unlockVault } from './vault.js';
import { timingSafeEqual } from 'node:crypto';
import { videoThumbnail } from './phone-thumbnails.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4' };
const sessionMs = 15 * 60 * 1000;

// Phone access belongs to the paired device and current desktop unlock session.
export function phoneLibrary(root, { library, unlock, allowed, available, endpoint }) {
  const grants = new Map(), attempts = new Map(), streams = new Set();
  function session(deviceId, collection, appSession = '') {
    const grant = grants.get(deviceId)?.get(collection.id);
    return grant && grant.session === appSession && grant.expires > Date.now() && grant.key === library.protection.checkpoint().get(collection.id)?.key;
  }
  function collectionFor(deviceId, id, requireAccess = true, appSession = '') {
    if (!allowed(deviceId)) throw fail('Enable phone browsing in Receive from phone on the desktop.', 403);
    if (!available()) throw fail('Papan is updating collection protection. Try again shortly.', 503);
    const collection = library.snapshot().collections.find(value => value.id === id && !value.closed);
    if (!collection) throw fail('This collection is no longer open on the desktop.', 404);
    if (requireAccess && collection.vault && (!library.protection.isUnlocked(id) || !session(deviceId, collection, appSession))) throw fail('Enter this collection’s password on your phone.', 423);
    return collection;
  }
  function invalidate() {
    for (const [deviceId, entries] of grants) {
      for (const [id, grant] of entries) {
        try { const collection = collectionFor(deviceId, id, false); if (!collection.vault || !session(deviceId, collection, grant.session)) entries.delete(id); }
        catch { entries.delete(id); }
      }
      if (!entries.size) grants.delete(deviceId);
    }
    for (const stream of streams) {
      try {
        collectionFor(stream.deviceId, stream.collectionId, true, stream.appSession);
        const pin = library.snapshot().pins.find(pin => pin.id === stream.pinId && pin.collectionId === stream.collectionId);
        if (!pin?.items.some(item => item.id === stream.itemId)) throw new Error();
      } catch { stream.controller.abort(); stream.response.destroy(); }
    }
  }
  const unsubscribe = library.subscribe(invalidate);
  const expiry = setInterval(invalidate, 1000); expiry.unref();
  const hasOriginal = item => Boolean(item.localFile || item.localPath || item.vault?.original);
  const hasPreview = item => Boolean(item.previewFile || item.previewPath || item.vault?.preview || hasOriginal(item));
  const mediaUrl = (pin, item, variant) => `${endpoint()}/v1/collections/${pin.collectionId}/pins/${pin.id}/items/${item.id}/media?variant=${variant}`;
  function boardPreview(collection) {
    const ratios = library.snapshot().pins.filter(pin => pin.collectionId === collection.id)
      .flatMap(pin => pin.items.filter(item => item.kind !== 'text' && !item.poseFor))
      .map(item => (item.previewWidth || item.width) / (item.previewHeight || item.height)).filter(ratio => Number.isFinite(ratio) && ratio > 0);
    const fit = collection.settings?.fit || 'contain';
    return { fit, measuredCount: ratios.length, aspectRatio: fit === 'cover' || !ratios.length ? 1 : ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length };
  }
  function pinView(pin) {
    const result = { ...pick(pin, ['id', 'collectionId', 'title', 'sourceUrl', 'notes', 'tags', 'text', 'author', 'coverId', 'createdAt']),
      items: pin.items.filter(item => !item.poseFor).map(item => ({ ...pick(item, ['id', 'kind', 'text', 'width', 'height', 'previewWidth', 'previewHeight', 'duration']),
        ...(hasPreview(item) ? { previewUrl: mediaUrl(pin, item, 'preview'), thumbnailUrl: mediaUrl(pin, item, 'thumbnail') } : {}),
        ...(hasOriginal(item) ? { originalUrl: mediaUrl(pin, item, 'original') } : {}) })) };
    let remaining = 32000;
    for (const value of [result, ...result.items]) if (typeof value.text === 'string') { const text = value.text.slice(0, Math.min(16000, remaining)); result.textTruncated ||= text.length < value.text.length; value.text = text; remaining -= text.length; }
    return result;
  }
  return {
    collectionFor, invalidate,
    clear(deviceId) { grants.delete(deviceId); attempts.delete(deviceId); invalidate(); },
    stop() { clearInterval(expiry); unsubscribe(); grants.clear(); for (const stream of streams) { stream.controller.abort(); stream.response.destroy(); } },
    async receive(request, response, deviceId, body, send) {
      const url = new URL(request.url, endpoint()), appSession = request.headers['x-papan-session'] || '';
      if (appSession && !/^[a-f0-9-]{36}$/i.test(appSession)) throw fail('Invalid phone app session.');
      if (request.method === 'POST' && url.pathname === '/v1/access/clear') {
        if (appSession) { const entries = grants.get(deviceId); for (const [id, grant] of entries || []) if (grant.session === appSession) entries.delete(id); if (!entries?.size) grants.delete(deviceId); }
        else grants.delete(deviceId);
        invalidate(); send(200, { cleared: true }); return true;
      }
      if (request.method === 'GET' && url.pathname === '/v1/collections') {
        if (!allowed(deviceId)) throw fail('Enable phone browsing in Receive from phone on the desktop.', 403);
        const collections = library.snapshot().collections.filter(value => !value.closed).map(value => {
          const locked = Boolean(value.vault && (!library.protection.isUnlocked(value.id) || !session(deviceId, value, appSession)));
          return { id: value.id, name: value.name, protected: Boolean(value.vault), locked, ...(!locked ? { preview: boardPreview(value) } : {}) };
        });
        send(200, { version: 1, collections }); return true;
      }
      const match = /^\/v1\/collections\/([0-9a-f-]{36})\/(unlock|pins)(?:\/([0-9a-f-]{36})\/items\/([0-9a-f-]{36})\/media)?$/i.exec(url.pathname);
      if (!match) return false;
      const [, id, action, pinId, itemId] = match;
      const collection = collectionFor(deviceId, id, action !== 'unlock', appSession);
      if (action === 'unlock' && !pinId && request.method === 'POST') {
        if (!collection.vault) throw fail('This collection is not password protected.');
        const input = await body(request);
        if (typeof input.password !== 'string' || !input.password || input.password.length > 1024) throw fail('Enter the collection password.');
        let rate = attempts.get(deviceId);
        if (!rate || Date.now() - rate.start >= 60000) { rate = { start: Date.now(), count: 0 }; attempts.set(deviceId, rate); }
        if (++rate.count > 5) throw fail('Too many password attempts. Wait a minute.', 429);
        // Desktop-unlocked collections still require proof of the phone user's password.
        let checked;
        try { checked = await unlockVault(library.protection.vaultPath(collection), input.password); }
        catch { throw fail('Incorrect password or unreadable protected collection.', 423); }
        try {
          await unlock(id, input.password);
          const current = collectionFor(deviceId, id, false), key = library.protection.checkpoint().get(id)?.key;
          if (!current.vault || !key || !library.protection.isUnlocked(id) || !timingSafeEqual(key, checked.key)) throw fail('The collection changed. Try again.', 423);
          if (!grants.has(deviceId)) grants.set(deviceId, new Map());
          grants.get(deviceId).set(id, { key, session: appSession, expires: appSession ? Infinity : Date.now() + sessionMs });
        } finally { checked.key.fill(0); }
        send(200, { id, unlocked: true, expiresIn: appSession ? null : sessionMs / 1000 }); return true;
      }
      if (action !== 'pins' || !['GET', 'HEAD'].includes(request.method)) throw fail('Not found.', 404);
      if (!pinId) {
        if (request.method !== 'GET') throw fail('Use GET.', 405);
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 40);
        const query = (url.searchParams.get('q') || '').trim().toLowerCase();
        if (query.length > 500) throw fail('Keep searches within 500 characters.');
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw fail('Invalid page.');
        const pins = library.snapshot().pins.filter(pin => pin.collectionId === id && (!query || [pin.title, pin.sourceUrl, pin.notes, pin.text, ...(pin.tags || [])].join(' ').toLowerCase().includes(query))).reverse();
        const page = []; let size = 0;
        for (const pin of pins.slice(offset, offset + limit)) { const value = pinView(pin), bytes = Buffer.byteLength(JSON.stringify(value)); if (page.length && size + bytes > 1024 * 1024) break; page.push(value); size += bytes; }
        send(200, { collectionId: id, pins: page, nextOffset: offset + page.length < pins.length ? offset + page.length : null }); return true;
      }
      const pin = library.snapshot().pins.find(pin => pin.id === pinId && pin.collectionId === id), item = pin?.items.find(item => item.id === itemId && !item.poseFor);
      const variant = url.searchParams.get('variant') || 'preview';
      if (!['original', 'preview', 'thumbnail'].includes(variant)) throw fail('Choose original, preview or thumbnail media.');
      if (!item || !(variant === 'original' ? hasOriginal(item) : hasPreview(item))) throw fail('Saved media is unavailable.', 404);
      const controller = new AbortController(), stream = { deviceId, appSession, collectionId: id, pinId, itemId, controller, response };
      streams.add(stream); response.once('close', () => { controller.abort(); streams.delete(stream); });
      try {
        const file = library.protection.media(item, variant === 'original') || mediaLocation(root, item, variant === 'original');
        if (!file) throw fail('Saved media is unavailable.', 404);
        if (variant === 'thumbnail' && item.kind === 'video') {
          const bytes = request.method === 'HEAD' ? null : await videoThumbnail(file, controller.signal);
          collectionFor(deviceId, id, true, appSession); controller.signal.throwIfAborted();
          response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'connection': 'close',
            'x-content-type-options': 'nosniff', ...(bytes ? { 'content-length': bytes.length } : {}) });
          response.end(bytes); return true;
        }
        const extension = typeof file === 'string' ? path.extname(file).toLowerCase() : file.ext;
        const result = await fileResponse(file, { method: request.method, headers: new Headers(request.headers), signal: controller.signal }, types[extension] || 'application/octet-stream');
        collectionFor(deviceId, id, true, appSession); controller.signal.throwIfAborted();
        response.writeHead(result.status, { ...Object.fromEntries(result.headers), 'cache-control': 'no-store', 'connection': 'close' });
        if (result.body) { const bytes = Readable.fromWeb(result.body); bytes.on('error', () => response.destroy()); response.once('close', () => bytes.destroy()); bytes.pipe(response); }
        else response.end();
      } catch (error) { if (!response.destroyed) throw fail('Saved media could not be read.', error.status || 404); }
      return true;
    },
  };
}
