import { inspectLink, extractWorker } from '../src/media.js';
import { mkdir, writeFile } from 'node:fs/promises';

const samples = [
  ['X images', 'https://x.com/perrypumas/status/894001459754180609'],
  ['X video', 'https://x.com/perrypumas/status/1065692031626829824'],
  ['YouTube video', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
  ['Instagram album', 'https://www.instagram.com/p/BoHk1haB5tM/'],
];
const versions = await extractWorker({ action: 'versions' });
const results = await Promise.all(samples.map(async ([name, url]) => {
  let result;
  try {
    const info = await inspectLink(url);
    result = { name, url, status: 'discovered', engine: info.engine, kinds: info.items.map(i => i.kind) };
  } catch (error) { result = { name, url, status: 'unavailable', error: error.message }; }
  console.log(JSON.stringify(result));
  return result;
}));
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/site-checks.json', JSON.stringify({ date: new Date().toISOString(), versions, publicOnly: true, results }, null, 2));
if (results.some(result => result.status !== 'discovered')) process.exitCode = 1;
