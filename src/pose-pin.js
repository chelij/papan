import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaLocation } from './collection-files.js';
import { MAX_FILE } from './media.js';
import { extractPose } from './pose.js';

export function poseSource(library, input) {
  if (!input || typeof input.id !== 'string' || typeof input.itemId !== 'string') throw new Error('Choose a saved video pin.');
  const options = input.poseOptions ?? { personCount: 0, jointConfidence: 0.3 };
  if (!options || !Number.isInteger(options.personCount) || options.personCount < 0 || options.personCount > 10 || !Number.isFinite(options.jointConfidence) || options.jointConfidence < 0.1 || options.jointConfidence > 0.9 || input.replacePose !== undefined && typeof input.replacePose !== 'boolean') throw new Error('Invalid pose cleanup settings.');
  const pin = library.snapshot().pins.find(pin => pin.id === input.id);
  if (!pin) throw new Error('Pin not found.');
  library.requireUnlocked(pin.collectionId);
  const item = pin.items.find(item => item.id === input.itemId && item.kind === 'video' && !item.poseFor);
  const file = item && (library.protection.media(item, true) || mediaLocation(library.root, item, true));
  if (!file) throw new Error('This pin has no saved video. Save its media first.');
  return { pin, item, file, options: { personCount: options.personCount, jointConfidence: options.jointConfidence } };
}

export async function savePosePin(input, { library, changeLibrary, extract = extractPose }, signal, progress = () => {}) {
  // posePinId remains readable for unfinished tasks from the separate-pin preview.
  const poseId = input.poseItemId || input.posePinId;
  if (!/^[0-9a-f-]{36}$/i.test(poseId || '')) throw new Error('Invalid pose task.');
  const { pin, item, file, options } = poseSource(library, input);
  const existing = pin.items.find(value => value.poseFor === item.id);
  if (input.replacePose && (!existing || poseId !== existing.id || !/^[0-9a-f-]{36}$/i.test(input.poseTaskId || ''))) throw new Error('The pose attachment changed. Reopen its source video and try again.');
  if (existing && (!input.replacePose || existing.poseTaskId === input.poseTaskId)) return { pin, item: existing, collectionId: pin.collectionId };
  if (!existing && pin.items.length >= 50) throw new Error('This pin has reached its 50 saved-item limit.');
  const legacy = input.posePinId && library.snapshot().pins.find(value => value.id === poseId);
  if (legacy) {
    const expected = new URL(pin.sourceUrl); expected.hash = `papan-pose-${poseId}`;
    if (legacy.collectionId !== pin.collectionId || legacy.sourceUrl !== expected.href || legacy.items.length !== 1 || legacy.items[0].kind !== 'video' || !legacy.tags?.includes('pose-control')) throw new Error('The earlier pose task conflicts with another saved pin.');
    return changeLibrary(draft => {
      signal?.throwIfAborted();
      const current = draft.pins.find(value => value.id === pin.id), previous = draft.pins.find(value => value.id === legacy.id);
      if (!current || JSON.stringify(previous) !== JSON.stringify(legacy) || JSON.stringify(current.items) !== JSON.stringify(pin.items)) throw new Error('The earlier pose task changed. Retry from its current pin.');
      library.requireUnlocked(current.collectionId, draft);
      const saved = { ...previous.items[0], poseFor: item.id };
      current.items.push(saved);
      draft.pins = draft.pins.filter(value => value.id !== previous.id);
      return { pin: current, item: saved, collectionId: current.collectionId };
    });
  }
  const folder = randomUUID(), stage = path.join(library.root, 'staging', folder), destination = path.join(library.root, 'media', folder);
  await mkdir(stage, { recursive: true, mode: 0o700 });
  let moved = false;
  try {
    const source = typeof file === 'string' ? file : path.join(stage, `reference${file.ext}`);
    if (typeof file !== 'string') {
      progress('preparing unlocked video…');
      await pipeline(Readable.from(file.stream(0, file.size - 1, signal)), createWriteStream(source, { mode: 0o600 }), { signal });
    }
    try { await extract(source, stage, path.join(library.root, 'pose-models'), signal, progress, options); }
    finally { if (typeof file !== 'string') await rm(source, { force: true }); }
    signal?.throwIfAborted();
    const size = (await stat(path.join(stage, 'pose.mp4'))).size;
    if (!size || size > MAX_FILE) throw new Error('The pose video is empty or exceeds 512 MiB.');
    await rename(stage, destination); moved = true;
    return await changeLibrary(draft => {
      signal?.throwIfAborted();
      const current = draft.pins.find(value => value.id === pin.id);
      if (!current || current.collectionId !== pin.collectionId || JSON.stringify(current.items.find(value => value.id === item.id)) !== JSON.stringify(item)) throw new Error('The source video changed or was removed. Retry pose extraction from its current pin.');
      library.requireUnlocked(current.collectionId, draft);
      const currentPose = current.items.find(value => value.poseFor === item.id);
      if (JSON.stringify(currentPose) !== JSON.stringify(existing)) throw new Error('The pose attachment changed. Reopen its source video and try again.');
      if (!existing && current.items.length >= 50) throw new Error('This pin has reached its 50 saved-item limit.');
      const saved = { id: poseId, kind: 'video', poseFor: item.id, poseOptions: options, ...(input.poseTaskId ? { poseTaskId: input.poseTaskId } : {}), localFile: `${folder}/pose.mp4`, previewFile: `${folder}/pose.mp4`, previewVersion: 1 };
      if (existing) current.items[current.items.indexOf(currentPose)] = saved;
      else current.items.push(saved);
      return { pin: current, item: saved, collectionId: current.collectionId };
    });
  } catch (error) {
    await rm(moved ? destination : stage, { recursive: true, force: true });
    throw error;
  }
}
