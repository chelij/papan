import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const defaultSettings = { mode: 'online', density: 3, fit: 'contain', motion: true, slideshowSeconds: 4 };

export function collectionSettings(input = {}) {
  const settings = { ...defaultSettings, ...input };
  // Keep these mappings while libraries with the earlier column settings are supported.
  if (input.density === undefined && input.columns !== undefined) settings.density = input.columns;
  if (input.density === undefined && input.columns === undefined && input.tileSize !== undefined) settings.density = { small: 4, medium: 3, large: 2 }[input.tileSize];
  if (!['online', 'offline'].includes(settings.mode) || !Number.isInteger(settings.density) || settings.density < 1 || settings.density > 10 ||
      !['cover', 'contain'].includes(settings.fit) || typeof settings.motion !== 'boolean' ||
      !Number.isInteger(settings.slideshowSeconds) || settings.slideshowSeconds < 1 || settings.slideshowSeconds > 10) {
    throw new Error('Invalid collection settings.');
  }
  return Object.fromEntries(Object.keys(defaultSettings).map(key => [key, settings[key]]));
}

export function collectionName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error('Use a collection name between 1 and 80 characters.');
  return value.trim();
}

export async function openLibrary(root) {
  await mkdir(path.join(root, 'media'), { recursive: true });
  const file = path.join(root, 'library.json');
  let data;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.collections) || !Array.isArray(data.pins)) throw new Error('Unrecognized library format.');
    for (const collection of data.collections) collection.settings = collectionSettings(collection.settings);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Papan could not read its library. Your files have been preserved. ${error.message}`);
    data = { version: 1, collections: [], pins: [] };
  }
  let queue = Promise.resolve();
  return {
    root,
    snapshot: () => structuredClone(data),
    mutate(operation) {
      const next = queue.then(async () => {
        const draft = structuredClone(data);
        const result = await operation(draft);
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, { mode: 0o600 });
        try { await copyFile(file, path.join(root, 'library.previous.json')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await rename(temporary, file);
        data = draft;
        return result;
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}

export function newCollection(name, settings) {
  return { id: randomUUID(), name: collectionName(name), settings: collectionSettings(settings), createdAt: new Date().toISOString() };
}
