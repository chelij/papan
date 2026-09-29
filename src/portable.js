import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { collectionContents, validateContents } from './collection-files.js';
import { extractWorker } from './media.js';

export async function exportBundle(root, snapshot, collection, file, signal) {
  const directory = path.join(root, 'staging', randomUUID()), temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true });
  try {
    const manifest = validateContents({ format: 'papan-collection', version: 1, revision: randomUUID(), ...collectionContents(snapshot, collection, root) });
    const files = [];
    for (const pin of manifest.pins) {
      delete pin.folder;
      for (const item of pin.items) for (const [field, kind] of [['previewPath', 'preview'], ['localPath', 'original']]) {
        if (!item[field]) continue;
        const name = `media/${files.length}-${kind}${path.extname(item[field]).toLowerCase()}`;
        files.push({ path: item[field], name }); item[field] = name;
      }
    }
    manifest.format = 'papan-bundle';
    const specification = path.join(directory, 'export.json');
    await writeFile(specification, JSON.stringify({ manifest, files }), { mode: 0o600 });
    const result = await extractWorker({ action: 'export-bundle', specification, output: temporary }, signal);
    signal?.throwIfAborted();
    await rename(temporary, file);
    return { ...result, file };
  } finally { await rm(directory, { recursive: true, force: true }); await rm(temporary, { force: true }); }
}

export async function importBundle(root, file, signal) {
  const folder = randomUUID(), stage = path.join(root, 'staging', folder), destination = path.join(root, 'media', folder);
  await mkdir(stage, { recursive: true });
  try {
    await extractWorker({ action: 'import-bundle', file, output: stage }, signal);
    const manifest = JSON.parse(await readFile(path.join(stage, 'collection.json'), 'utf8'));
    for (const pin of manifest.pins) for (const item of pin.items) for (const field of ['previewPath', 'localPath']) {
      if (item[field]) item[field] = path.join(destination, path.basename(item[field]));
    }
    const validated = validateContents({ ...manifest, format: 'papan-collection' });
    const collection = { ...validated.collection, id: randomUUID(), closed: false };
    const pins = validated.pins.map(pin => ({ ...pin, id: randomUUID(), collectionId: collection.id, folder,
      items: pin.items.map(item => {
        const { previewPath, localPath, ...rest } = item;
        return { ...rest, previewFile: previewPath ? `${folder}/${path.basename(previewPath)}` : null,
          localFile: localPath ? `${folder}/${path.basename(localPath)}` : null };
      }) }));
    signal?.throwIfAborted();
    await rename(path.join(stage, 'media'), destination);
    return { collection, pins, folder };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
