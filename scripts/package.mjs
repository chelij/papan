import { packager } from '@electron/packager';
import { access, readFile, writeFile, readdir, mkdir, copyFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const metadata = JSON.parse(await readFile('package.json', 'utf8'));
await access(path.join('vendor', process.platform === 'win32' ? 'papan-extract.exe' : 'papan-extract'));
await access(path.join('vendor', process.platform === 'win32' ? 'papan-pose.exe' : 'papan-pose'));
const poseExecutable = path.join('vendor', process.platform === 'win32' ? 'papan-pose.exe' : 'papan-pose');
const poseAsset = `Papan-pose-${metadata.version}-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
const poseBytes = await readFile(poseExecutable), poseHash = createHash('sha256').update(poseBytes).digest('hex');
await mkdir('dist', { recursive: true });
await copyFile(poseExecutable, path.join('dist', poseAsset));
await writeFile(path.join('dist', `${poseAsset}.sha256`), `${poseHash}  ${poseAsset}\n`);
await writeFile('vendor/pose-runtime.json', JSON.stringify({ platform: process.platform, arch: process.arch, size: poseBytes.length, sha256: poseHash,
  url: `https://github.com/chelij/papan/releases/download/v${metadata.version}/${poseAsset}` }, null, 2) + '\n');
await access(path.join('vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
const codecs = spawnSync(process.execPath, ['scripts/check-codecs.mjs'], { stdio: 'inherit' });
if (codecs.status !== 0) throw new Error('Release codec verification failed.');
const packages = JSON.parse(await readFile('package-lock.json', 'utf8')).packages;
const inventory = [];
await mkdir('vendor/licenses', { recursive: true });
for (const [directory, entry] of Object.entries(packages)) {
  if (!directory || entry.dev) continue;
  let info;
  try { info = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  inventory.push({ name: info.name, version: info.version, license: info.license, source: info.repository, resolved: entry.resolved, integrity: entry.integrity });
  const target = path.join('vendor/licenses', `${info.name.replaceAll('/', '__')}@${info.version}`);
  await mkdir(target, { recursive: true });
  for (const file of await readdir(directory)) if (/^(license|copying|notice|copyright)(\.|$)/i.test(file)) {
    try { await copyFile(path.join(directory, file), path.join(target, file)); } catch (error) { if (error.code !== 'EISDIR') throw error; }
  }
}
await writeFile('vendor/licenses/node-packages.json', JSON.stringify(inventory, null, 2));
await copyFile('THIRD-PARTY.md', 'vendor/licenses/THIRD-PARTY.md');
const outputs = await packager({ dir: '.', name: 'Papan', out: 'dist', overwrite: true, prune: true, asar: false,
  executableName: 'papan', appBundleId: 'id.papan.desktop', appCategoryType: 'public.app-category.lifestyle',
  appCopyright: 'Copyright © 2026 Cheliyono Jenardi',
  icon: `assets/icon.${process.platform === 'darwin' ? 'icns' : process.platform === 'win32' ? 'ico' : 'png'}`,
  ignore: [/^\/(test|scripts|docs|artifacts|dist|build|\.venv(?:-pose)?|\.github|worker|extensions)(\/|$)/, /^\/\.git/, /^\/AGENTS\.md$/, /\.log$/,
    /^\/node_modules\/ffmpeg-static\/ffmpeg(\.exe|\.README|\.LICENSE)?$/, /^\/vendor\/papan-pose(\.exe)?$/],
});
const python = path.join('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
for (const output of outputs) {
  const app = path.join(output, process.platform === 'darwin' ? 'Papan.app/Contents/Resources/app' : 'resources/app');
  for (const file of ['.venv-pose', path.join('vendor', process.platform === 'win32' ? 'papan-pose.exe' : 'papan-pose')]) {
    try { await lstat(path.join(app, file)); throw new Error('Pose dependencies must not ship in the base app.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz';
  const archive = path.join('dist', `Papan-${metadata.version}-${process.platform}-${process.arch}.${extension}`);
  const result = spawnSync(python, ['-c', 'import sys,shutil,pathlib; source=pathlib.Path(sys.argv[1]); fmt=sys.argv[3]; shutil.make_archive(sys.argv[2],fmt,root_dir=source.parent,base_dir=source.name)',
    output, archive.slice(0, -(extension.length + 1)), extension === 'zip' ? 'zip' : 'gztar'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Could not archive the desktop build.');
  await writeFile(`${archive}.sha256`, `${createHash('sha256').update(await readFile(archive)).digest('hex')}  ${path.basename(archive)}\n`);
  console.log(archive);
}
