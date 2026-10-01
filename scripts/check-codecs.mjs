import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ffmpeg = path.resolve('vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', 'test/media/av1.mp4',
  '-an', '-vf', 'scale=96:72,setsar=1,fps=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'null', '-'], { encoding: 'utf8', timeout: 30000 });
if (result.error || result.status !== 0) throw new Error(`The release media tools could not decode AV1 and encode an H.264 preview: ${result.error?.message || result.stderr}`);
console.log('Release media tools decoded AV1 and encoded an H.264 preview.');
const colors = spawnSync(process.execPath, ['--test', '--test-name-pattern=portrait video', 'test/core.test.js'], { stdio: 'inherit', timeout: 30000 });
if (colors.error || colors.status !== 0) throw new Error('Release video preview colors failed verification.');
