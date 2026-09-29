import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Keep source and checksums with the exact binary we distribute.
const sources = [
  { file: 'ffmpeg-7.0.2.tar.xz', url: 'https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz', sha256: '8646515b638a3ad303e23af6a3587734447cb8fc0a0c064ecdb8e95c4fd8b389' },
  { file: 'x264-baee400.tar.gz', url: 'https://codeload.github.com/mirror/x264/tar.gz/baee400fa9ced6f5481a728138fed6e867b0ff7f', sha256: '436a2be54d8bc0cb05dd33ecbbcb7df9c3b57362714fcdaa3a5991189a33319b' },
];
await mkdir('vendor/native-source', { recursive: true });
for (const source of sources) {
  const target = path.join('vendor/native-source', source.file);
  let bytes;
  try { bytes = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Could not download ${source.file}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Source checksum mismatch: ${source.file}`);
    await writeFile(target, bytes);
  }
}
await writeFile('vendor/native-source/sources.json', JSON.stringify(sources, null, 2) + '\n');
await copyFile('scripts/build-ffmpeg.sh', 'vendor/native-source/build-ffmpeg.sh');
await copyFile('scripts/build-ffmpeg.mjs', 'vendor/native-source/build-ffmpeg.mjs');
const result = spawnSync('bash', ['scripts/build-ffmpeg.sh'], { stdio: 'inherit', shell: false });
if (result.status !== 0) throw new Error(`FFmpeg build failed. Install a C compiler, make, pkg-config and Bash. ${result.error?.message || ''}`);
