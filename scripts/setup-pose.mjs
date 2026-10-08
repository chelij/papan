import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const python = path.resolve('.venv-pose', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error(`Pose-tool setup failed. ${result.error?.message || ''}`);
}
if (!existsSync(python)) {
  const candidates = process.platform === 'win32' ? [['python'], ['py', '-3']] : [['python3'], ['python']];
  const installed = candidates.find(([command, ...args]) => spawnSync(command, [...args, '--version'], { stdio: 'ignore' }).status === 0);
  if (!installed) throw new Error('Install Python 3.11 or newer to develop the pose helper.');
  run(installed[0], [...installed.slice(1), '-m', 'venv', '.venv-pose']);
}
run(python, ['-m', 'pip', 'install', '--no-deps', '-r', 'requirements-pose.txt']);
