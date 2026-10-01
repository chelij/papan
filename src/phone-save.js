import { randomUUID } from 'node:crypto';
import { pinDetails } from './library.js';

// Mobile capture deliberately uses all extracted items and the first item as cover.
export async function savePhoneLink(task, { snapshot, requireUnlocked, inspect, save }, signal, progress) {
  const { url, collectionId } = task.payload;
  requireUnlocked(collectionId);
  const existing = source => snapshot().pins.find(pin => pin.collectionId === collectionId && (pin.id === task.id || pin.sourceUrl === source));
  let pin = existing(url);
  if (pin) return { collectionId, pinId: pin.id };
  progress('finding media…');
  const data = await inspect(url, signal);
  signal.throwIfAborted();
  requireUnlocked(collectionId);
  pin = existing(data.sourceUrl);
  if (pin) return { collectionId, pinId: pin.id };
  const items = data.items.slice(0, 50).map(item => ({ ...item, id: randomUUID() }));
  if (!items.length) throw new Error('No saveable media or readable text was found.');
  try {
    const result = await save({ pin: { id: task.id, collectionId, sourceUrl: data.sourceUrl, engine: data.engine,
      ...pinDetails({ title: data.title?.trim() || 'shared link' }), author: data.author, text: data.text, items,
      coverId: items[0].id, createdAt: task.createdAt } }, signal, progress);
    return { collectionId, pinId: result.pin.id };
  } catch (error) {
    pin = existing(data.sourceUrl);
    if (!pin) throw error;
    return { collectionId, pinId: pin.id };
  }
}
