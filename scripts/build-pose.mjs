import { spawnSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const python = path.resolve('.venv-pose', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const setup = spawnSync(process.execPath, ['scripts/setup-pose.mjs'], { stdio: 'inherit', shell: false });
if (setup.status !== 0) throw new Error('Could not set up the optional pose runtime for release building.');
function run(args) {
  const result = spawnSync(python, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error(`Pose-tool build failed. ${result.error?.message || ''}`);
}
run(['-m', 'pip', 'install', 'pyinstaller==6.22.3']);
run(['test/pose-worker.py']);
run(['-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--name', 'papan-pose',
  '--distpath', 'vendor', '--workpath', 'build/pose', '--specpath', 'build',
  '--collect-all', 'rtmlib', '--collect-all', 'onnxruntime', 'worker/pose.py']);
await mkdir('vendor/pose-source', { recursive: true });
await copyFile('worker/pose.py', 'vendor/pose-source/pose.py');
await copyFile('requirements-pose.txt', 'vendor/pose-source/requirements-pose.txt');
await copyFile('LICENSE', 'vendor/pose-source/LICENSE');
run(['scripts/collect-pose-licenses.py']);
const runtime = path.resolve('vendor', process.platform === 'win32' ? 'papan-pose.exe' : 'papan-pose');
const probe = spawnSync(runtime, [], { input: JSON.stringify({ stage: path.resolve('vendor'), segments: [], models: [] }), encoding: 'utf8', timeout: 60000, shell: false });
assert.equal(probe.status, 1, probe.error?.message || probe.stderr || probe.stdout);
assert.equal(JSON.parse(probe.stdout.trim()).error, 'Invalid pose video segments.', 'Packaged pose runtime must import its native dependencies before rejecting the fixture request.');
