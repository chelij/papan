// Documentation only: this creates and deletes a temporary profile, never the user's library.
import { _electron as electron, expect } from 'playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { newCollection } from '../src/library.js';

const catalog = JSON.parse(await readFile('docs/demo/catalog.json', 'utf8'));
await mkdir('artifacts/demo', { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), 'papan-readme-'));
let app;
try {
  const collections = ['color & light', 'composition', 'reading room'].map(name => newCollection(name, { density: 4, motion: false, openAction: 'saved' }));
  const pins = [];
  for (const [index, artwork] of catalog.entries()) {
    if (!artwork.isPublicDomain) throw new Error('Only public-domain artwork belongs in this demo.');
    const previewPath = path.resolve('artifacts/demo', `${artwork.objectID}.jpg`);
    try { await access(previewPath); } catch {
      const response = await fetch(artwork.primaryImageSmall, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Artwork download failed: ${response.status}`);
      await writeFile(previewPath, Buffer.from(await response.arrayBuffer()));
    }
    const { width, height } = await sharp(previewPath).metadata();
    const item = { id: randomUUID(), key: String(artwork.objectID), kind: 'image', url: artwork.primaryImageSmall, previewPath, previewWidth: width, previewHeight: height };
    pins.push({ id: randomUUID(), collectionId: collections[0].id, title: artwork.title, sourceUrl: artwork.objectURL,
      author: artwork.artistDisplayName, text: `${artwork.artistDisplayName}, ${artwork.objectDate}. The Metropolitan Museum of Art. Public domain.`,
      engine: 'page', offline: false, coverId: item.id, items: [item], tags: index < 5 ? ['color', 'painting'] : ['composition', 'painting'],
      notes: index === 0 ? 'The warm wheat against the cool sky. Keep this palette in mind for the next poster.' : '', createdAt: new Date().toISOString() });
  }
  // A second collection makes the library-wide search visible in screenshots.
  pins.push({ ...structuredClone(pins[2]), id: randomUUID(), collectionId: collections[1].id, tags: ['color', 'composition'], notes: 'Study the balance between the flowers and the open background.' });
  await mkdir(path.join(profile, 'library'), { recursive: true });
  await writeFile(path.join(profile, 'library/library.json'), JSON.stringify({ version: 1, collections, pins }));
  app = await electron.launch({ args: [process.cwd()], env: { ...process.env, PAPAN_DATA_DIR: profile, ELECTRON_RUN_AS_NODE: undefined } });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 720 });
  await expect(page.locator('.pin')).toHaveCount(catalog.length);
  await page.waitForFunction(() => [...document.querySelectorAll('.tile-media img')].length >= 8 && [...document.querySelectorAll('.tile-media img')].every(img => img.complete && img.naturalWidth));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.move(0, 950);
  await page.screenshot({ path: 'docs/demo/board.png' });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByLabel(`Details for ${catalog[0].title}`, { exact: true }).click();
  await page.getByRole('button', { name: 'edit pin', exact: true }).click();
  await page.mouse.move(0, 950);
  await page.screenshot({ path: 'docs/demo/edit.png' });
  await page.getByLabel('Close pin editor', { exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 780 });
  await page.getByRole('button', { name: 'Search collection', exact: true }).click();
  await page.getByLabel('search in', { exact: true }).selectOption('all');
  await page.getByLabel('tag', { exact: true }).selectOption('color');
  await page.locator('#search').press('Escape');
  await expect(page.locator('.pin')).toHaveCount(6);
  await page.waitForFunction(() => [...document.querySelectorAll('.tile-media img')].every(img => img.complete && img.naturalWidth));
  await page.mouse.move(0, 950);
  await page.screenshot({ path: 'docs/demo/search.png' });
  const credits = '# Demo artwork\n\nThese screenshots show the real Papan app with a temporary, documentation-only collection. No artwork or sample library is installed with Papan.\n\nAll artwork below is marked public domain in [The Met Collection API](https://metmuseum.github.io/), whose Open Access images and data are offered under CC0. Metadata was retrieved on 29 September 2026. The museum does not endorse Papan.\n\n' + catalog.map(item => `- [${item.title}](${item.objectURL}) — ${item.artistDisplayName}, ${item.objectDate}. The Metropolitan Museum of Art.`).join('\n') + '\n\nRun `npm run demo` to recreate the screenshots. It downloads the credited images into ignored `artifacts/demo/`, builds an isolated temporary library, captures the app, and deletes that library.\n';
  await writeFile('docs/demo/credits.md', credits);
  console.log('Captured README screenshots without changing the user library.');
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
