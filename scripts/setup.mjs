import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error(`${command} failed. ${result.error?.message || ''}`);
}
if (!existsSync(python)) {
  const candidates = process.platform === 'win32' ? [['python'], ['py', '-3']] : [['python3'], ['python']];
  const installed = candidates.find(([command, ...args]) => spawnSync(command, [...args, '--version'], { stdio: 'ignore' }).status === 0);
  if (!installed) throw new Error('Install Python 3.11 or newer to develop Papan. Packaged builds include the media tools.');
  run(installed[0], [...installed.slice(1), '-m', 'venv', '.venv']);
}
run(python, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
run(process.execPath, ['node_modules/electron/install.js']);
run(process.execPath, ['node_modules/ffmpeg-static/install.js']);
