import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { ffmpeg } from './media.js';

let queue = Promise.resolve();

export async function videoThumbnail(file, signal) {
  const previous = queue; let release;
  queue = new Promise(resolve => { release = resolve; });
  try {
    await previous; signal?.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const encrypted = typeof file !== 'string';
      const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe',
        '-i', encrypted ? 'pipe:0' : file, '-frames:v', '1', '-vf', "scale=w='min(480,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease:flags=bicubic+accurate_rnd",
        '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const input = encrypted ? Readable.from(file.stream(0, file.size - 1, signal)) : null;
      const chunks = []; let size = 0, settled = false;
      const finish = (error, bytes) => {
        if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        input?.destroy(); child.stdin.destroy(); error ? reject(error) : resolve(bytes);
      };
      const stop = error => { child.kill('SIGKILL'); finish(error); };
      const cancel = () => stop(signal.reason || new Error('Thumbnail cancelled.'));
      const timer = setTimeout(() => stop(new Error('Video thumbnail took too long.')), 8000);
      signal?.addEventListener('abort', cancel, { once: true });
      child.on('error', error => finish(error));
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) stop(new Error('Video thumbnail is too large.')); else chunks.push(chunk); });
      child.on('close', code => {
        const bytes = Buffer.concat(chunks);
        finish(code || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 ? new Error('Video thumbnail is unavailable.') : null, bytes);
      });
      child.stdin.on('error', () => {});
      if (input) { input.on('error', stop); input.pipe(child.stdin); } else child.stdin.end();
    });
  } finally { release(); }
}
