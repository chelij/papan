import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(args) {
  const result = spawnSync(python, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error(`Media-tool build failed. ${result.error?.message || ''}`);
}
run(['-m', 'pip', 'install', 'pyinstaller==6.22.3']);
run(['-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--name', 'papan-extract',
  '--distpath', 'vendor', '--workpath', 'build/python', '--specpath', 'build',
  '--collect-all', 'gallery_dl', '--collect-all', 'yt_dlp', '--collect-all', 'yt_dlp_ejs', '--collect-all', 'instaloader',
  '--collect-data', 'certifi', 'worker/extract.py']);
await mkdir(path.join(root, 'vendor', 'source'), { recursive: true });
await copyFile(path.join(root, 'worker', 'extract.py'), path.join(root, 'vendor', 'source', 'extract.py'));
await copyFile(path.join(root, 'requirements.txt'), path.join(root, 'vendor', 'source', 'requirements.txt'));
// Retain the source distributions and their license files alongside the helper.
run(['-m', 'pip', 'download', '--no-deps', '--no-binary=:all:', '--dest', 'vendor/source', '-r', 'requirements.txt']);
await writeFile(path.join(root, 'vendor', 'THIRD-PARTY.txt'),
  'Papan media helper uses gallery-dl (GPL-2.0), yt-dlp (Unlicense), Instaloader (MIT), and their dependencies.\n' +
  'Upstream source distributions and the helper source are in source/.\n' +
  'gallery-dl: https://codeberg.org/mikf/gallery-dl\n' +
  'yt-dlp: https://github.com/yt-dlp/yt-dlp\n' +
  'Instaloader: https://github.com/instaloader/instaloader\n' +
  'FFmpeg and its license are shipped in node_modules/ffmpeg-static.\n');
