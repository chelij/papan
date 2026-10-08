import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, readFile, chmod, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { preparePoseSegments, combinePoseSegments, ffmpeg } from './media.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const POSE_GUIDE = 'https://github.com/IDEA-Research/DWPose';
const revision = '1a7144101628d69ee7a3768d1ee3a094070dc388';
export const POSE_MODELS = [
  { name: 'yolox_l.onnx', size: 216746733, sha256: '7860ae79de6c89a3c1eb72ae9a2756c0ccfbe04b7791bb5880afabd97855a411' },
  { name: 'dw-ll_ucoco_384.onnx', size: 134399116, sha256: '724f4ff2439ed61afb86fb8a1951ec39c6220682803b4a8bd4f598cd913b1843' },
].map(model => ({ ...model, url: `https://huggingface.co/yzd-v/DWPose/resolve/${revision}/${model.name}` }));

export async function ensurePoseModels(cache, signal, progress = () => {}, { models = POSE_MODELS, fetchImpl = fetch, label = 'pose model' } = {}) {
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const files = [];
  for (const model of models) {
    signal?.throwIfAborted();
    const file = path.join(cache, model.name), hash = createHash('sha256');
    try {
      for await (const chunk of createReadStream(file)) { signal?.throwIfAborted(); hash.update(chunk); }
      if (hash.digest('hex') === model.sha256) { files.push(file); continue; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = `${file}.${randomUUID()}.part`;
    try {
      progress(`downloading ${label} ${files.length + 1} of ${models.length}…`);
      const response = await fetchImpl(model.url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Pose model download failed (HTTP ${response.status}). Check your connection and retry.`); }
      const digest = createHash('sha256');
      let bytes = 0, reported = -1;
      await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length; digest.update(chunk);
        const percent = Math.floor(bytes * 100 / model.size);
        if (percent !== reported) { reported = percent; progress(`downloading ${label} ${files.length + 1} of ${models.length} · ${Math.min(percent, 100)}%`); }
        callback(bytes > model.size ? new Error('Pose model download exceeded its expected size.') : null, chunk);
      } }), createWriteStream(temporary, { mode: 0o600 }), { signal });
      if (bytes !== model.size || digest.digest('hex') !== model.sha256) throw new Error('Pose model download was incomplete or corrupted. Retry to download it again.');
      signal?.throwIfAborted();
      await rename(temporary, file);
      files.push(file);
    } finally { await rm(temporary, { force: true }); }
  }
  return files;
}

async function poseRuntime() {
  if (process.env.PAPAN_POSE_WORKER === '1' && existsSync(path.join(project, 'worker/pose.py'))) return null;
  let runtime;
  try { runtime = JSON.parse(await readFile(path.join(project, 'vendor/pose-runtime.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (runtime.platform !== process.platform || runtime.arch !== process.arch || !/^[0-9a-f]{64}$/.test(runtime.sha256) || !Number.isSafeInteger(runtime.size) || runtime.size < 1 || runtime.size > 512 * 1024 * 1024 || typeof runtime.url !== 'string' || !runtime.url.startsWith('https://github.com/chelij/papan/releases/download/')) throw new Error('The pose runtime download information is invalid for this computer. Reinstall Papan.');
  return { ...runtime, name: `papan-pose-${runtime.sha256}${process.platform === 'win32' ? '.exe' : ''}` };
}

export async function ensurePoseRuntime(cache, signal, progress = () => {}, { runtime, fetchImpl = fetch } = {}) {
  if (runtime === undefined) runtime = await poseRuntime();
  if (!runtime) return poseTools(); // Source development keeps the explicit setup:pose path.
  const [command] = await ensurePoseModels(path.join(cache, 'runtime'), signal, progress, { models: [runtime], fetchImpl, label: 'pose runtime' });
  await chmod(command, 0o700);
  return { command, args: [] };
}

export async function poseSetup(cache) {
  const runtime = await poseRuntime(), tools = runtime ? null : poseTools();
  const files = [...POSE_MODELS.map(model => ({ ...model, file: path.join(cache, model.name), kind: 'models' })),
    ...(runtime ? [{ ...runtime, file: path.join(cache, 'runtime', runtime.name), kind: 'runtime' }] : [])];
  let runtimeBytes = 0, modelBytes = 0;
  for (const file of files) {
    let valid = false;
    try {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file.file)) hash.update(chunk);
      valid = hash.digest('hex') === file.sha256;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!valid) { if (file.kind === 'runtime') runtimeBytes += file.size; else modelBytes += file.size; }
  }
  return { runtimeBytes, modelBytes, downloadBytes: runtimeBytes + modelBytes,
    totalBytes: POSE_MODELS.reduce((sum, file) => sum + file.size, 0) + (runtime?.size || (await stat(tools.command)).size),
    platform: `${process.platform} ${process.arch}` };
}

function poseTools() {
  const executable = path.join(project, 'vendor', process.platform === 'win32' ? 'papan-pose.exe' : 'papan-pose');
  const bundled = existsSync(executable) && process.env.PAPAN_POSE_WORKER !== '1';
  const command = bundled ? executable : path.join(project, '.venv-pose', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(command)) throw new Error('Pose tools are missing. Run npm run setup:pose in the project, or reinstall the packaged app.');
  return { command, args: bundled ? [] : [path.join(project, 'worker', 'pose.py')] };
}

export function poseWorker(request, signal, progress = () => {}, { command, args } = {}) {
  if (!command) ({ command, args } = poseTools());
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(command, args || [], { windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1', ELECTRON_RUN_AS_NODE: '1' } });
    let buffer = '', stderr = '', result, failure, settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (error || failure || !result) reject(error || failure || new Error(`The pose worker stopped unexpectedly. ${stderr.slice(-300)}`));
      else resolve(result);
    };
    const stop = error => {
      if (child.pid) {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      }
      failure = error;
    };
    const cancel = () => stop(new Error('Cancelled.'));
    const timer = setTimeout(() => stop(new Error('Pose extraction timed out. Retry with a shorter video.')), 60 * 60 * 1000);
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { stop(new Error('The pose worker returned too much data.')); return; }
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (typeof event.progress === 'string') progress(event.progress.slice(0, 300));
          else if (event.ok === false) failure = new Error(String(event.error || 'Pose extraction failed.').slice(0, 400));
          else if (event.ok === true && event.result?.frames > 0 && event.result?.detectedFrames > 0) result = event.result;
        } catch { stop(new Error('The pose worker returned an invalid response.')); }
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', error => finish(new Error(`Could not start the pose tools: ${error.message}`)));
    child.on('close', code => finish(code && !failure ? new Error(`Pose extraction failed. ${stderr.slice(-300)}`) : undefined));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

export async function extractPose(file, stage, cache, signal, progress = () => {}, options = { personCount: 0, jointConfidence: 0.3 }) {
  // Check the local worker before downloading weights; it never calls ComfyUI.
  const tools = await ensurePoseRuntime(cache, signal, progress);
  const models = await ensurePoseModels(cache, signal, progress);
  progress('preparing the complete video…');
  const segments = await preparePoseSegments(file, stage, signal);
  const result = await poseWorker({ stage, segments, models, ffmpeg, options }, signal, progress, tools);
  progress('saving pose control video…');
  await combinePoseSegments(stage, segments.length, signal);
  return result;
}
