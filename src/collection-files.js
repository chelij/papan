import { copyFile, lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { isVault, vaultHeader } from './vault.js';
import { collectionName, collectionSettings, pinDetails, pinPreviews } from './library.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mediaPath = /^[0-9a-f-]{36}\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/;
const mediaExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg', '.heic', '.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.ts']);

export function mediaLocation(root, item, original = false) {
  for (const kind of original ? ['local', 'preview'] : ['preview', 'local']) {
    if (item[`${kind}Path`]) return path.isAbsolute(item[`${kind}Path`]) ? item[`${kind}Path`] : null;
    if (item[`${kind}File`] && mediaPath.test(item[`${kind}File`])) return path.join(root, 'media', item[`${kind}File`]);
  }
  return null;
}

export function collectionContents(snapshot, collection, root) {
  if (collection.vault) return { vault: collection.vault };
  const id = collection.fileId || collection.id;
  return { collection: { id, name: collection.name, settings: collection.settings, createdAt: collection.createdAt },
    pins: snapshot.pins.filter(pin => pin.collectionId === collection.id).map(pin => ({ ...pin, collectionId: id,
      items: pin.items.map(item => {
        const { previewFile, localFile, ...saved } = item;
        return { ...saved, previewPath: item.previewPath || (previewFile ? path.join(root, 'media', previewFile) : null),
          localPath: item.localPath || (localFile ? path.join(root, 'media', localFile) : null) };
      }) })) };
}

export function validateContents(data) {
  if (data?.format !== 'papan-collection' || data.version !== 1 || !uuid.test(data.revision) ||
      !uuid.test(data.collection?.id) || !Array.isArray(data.pins)) throw new Error('This is not a supported Papan collection.');
  data.collection = { id: data.collection.id, name: collectionName(data.collection.name), settings: collectionSettings(data.collection.settings), createdAt: data.collection.createdAt };
  const ids = new Set();
  const checkURL = value => {
    if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid media link in collection.');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid media link in collection.');
  };
  for (const pin of data.pins) {
    if (!uuid.test(pin?.id) || ids.has(pin.id) || pin.collectionId !== data.collection.id || typeof pin.title !== 'string' ||
        !Array.isArray(pin.items) || !pin.items.length || pin.items.length > 50 || typeof pin.offline !== 'boolean' ||
        (pin.folder !== undefined && !uuid.test(pin.folder)) || !['page', 'gallery', 'video', 'instagram'].includes(pin.engine)) throw new Error('Invalid pin in collection.');
    ids.add(pin.id);
    Object.assign(pin, pinDetails(pin));
    checkURL(pin.sourceUrl);
    const itemIds = new Set();
    for (const item of pin.items) {
      if (!uuid.test(item?.id) || itemIds.has(item.id) || !['image', 'video', 'text'].includes(item.kind)) throw new Error('Invalid media in collection.');
      itemIds.add(item.id);
      for (const field of ['url', 'poster']) if (item[field]) checkURL(item[field]);
      for (const field of ['previewPath', 'localPath']) if (item[field] != null &&
          (typeof item[field] !== 'string' || item[field].length > 32768 || item[field].includes('\0') ||
           !(path.posix.isAbsolute(item[field]) || path.win32.isAbsolute(item[field])) ||
           !mediaExtensions.has(path.extname(item[field]).toLowerCase()))) throw new Error('Invalid saved media path in collection.');
      if (item.kind === 'text' ? typeof item.text !== 'string' : !item.previewPath && !item.localPath && !item.url) throw new Error('Collection media is incomplete.');
      for (const field of ['width', 'height', 'previewWidth', 'previewHeight']) {
        if (item[field] != null && (!Number.isFinite(item[field]) || item[field] < 0)) throw new Error('Invalid media dimensions.');
      }
      delete item.previewFile; delete item.localFile; delete item.vault; delete item.encrypted;
    }
    if (!itemIds.has(pin.coverId)) throw new Error('Invalid collection cover.');
    if (pin.items.some(item => item.poseFor !== undefined && (item.kind !== 'video' || item.id === pin.coverId || !pin.items.some(source => source.id === item.poseFor && source.kind === 'video' && !source.poseFor) || pin.items.filter(pose => pose.poseFor === item.poseFor).length !== 1))) throw new Error('Invalid pose attachment.');
    if (pin.previews !== undefined) pin.previews = pinPreviews(pin.previews, pin.items, pin.coverId);
  }
  return data;
}

async function readManifest(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('Invalid or oversized collection file.');
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('This file is not a valid Papan collection.'); throw error; }
  return validateContents(data);
}

export async function saveCollectionFile(root, snapshot, collection) {
  const file = collection.destination;
  try { await realpath(path.dirname(file)); }
  catch { throw new Error('The collection destination is unavailable. Reconnect it or choose another destination.'); }
  let previous;
  try { previous = await isVault(file) ? { encrypted: true, ...(await vaultHeader(file)) } : await readManifest(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && (previous.encrypted ? previous.revision !== collection.destinationRevision : previous.collection.id !== (collection.fileId || collection.id) ||
      (collection.destinationRevision && previous.revision !== collection.destinationRevision))) {
    throw new Error('This file contains another or newer collection. Open it before editing, or choose another destination.');
  }
  if (!previous && collection.destinationRevision) throw new Error('The saved collection file is missing. Choose a destination again to save a new file.');
  const encryptedFile = collection.vault ? path.join(root, 'vaults', collection.vault.file) : null;
  const data = encryptedFile ? await vaultHeader(encryptedFile) : validateContents({ format: 'papan-collection', version: 1, revision: randomUUID(), ...collectionContents(snapshot, collection, root) });
  const backupFile = `${file.slice(0, -path.extname(file).length)}.previous.papan`;
  if (previous) {
    try {
      const existing = await isVault(backupFile) ? null : await readManifest(backupFile);
      if (existing && existing.collection.id !== (collection.fileId || collection.id)) throw new Error('Another collection uses the backup file.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('The backup location contains another file. Choose another destination to preserve it.');
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`, backup = `${temporary}.previous`;
  try {
    if (encryptedFile) await copyFile(encryptedFile, temporary);
    else await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    if (previous) {
      // An encrypted save never creates or retains a plaintext external backup.
      const resetBackup = encryptedFile && (!previous.encrypted || !previous.envelope.equals(data.envelope));
      await copyFile(resetBackup ? encryptedFile : file, backup);
      await rename(backup, backupFile);
    }
    await rename(temporary, file);
    return data.revision;
  } finally {
    await rm(temporary, { force: true });
    await rm(backup, { force: true });
  }
}

export async function readCollectionFile(file, snapshot) {
  const destination = path.join(await realpath(path.dirname(file)), path.basename(file));
  const data = await readManifest(destination);
  const existing = snapshot.collections.find(collection => collection.destination === destination);
  if (existing && (existing.fileId || existing.id) !== data.collection.id) throw new Error('This destination now contains a different collection. Choose another file.');
  const id = existing?.id || (snapshot.collections.some(collection => collection.id === data.collection.id) ? randomUUID() : data.collection.id);
  const collection = { ...data.collection, id, fileId: data.collection.id, destination, destinationRevision: data.revision, closed: false };
  return { collection, pins: data.pins.map(pin => ({ ...pin, id: randomUUID(), collectionId: id })) };
}
