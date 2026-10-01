import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

export async function startFixture({ video = false, extraVideo = false } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'papan-fixture-'));
  if (video) {
    for (const [name, duration] of [['clip.mp4', '12'], ...(extraVideo ? [['clip-short.mp4', '6']] : [])]) {
      const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x960:rate=20', '-t', duration, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(dir, name)]);
      if (result.status) throw new Error(result.stderr.toString());
    }
  }
  const wideImage = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: '#c99375' } }).png().toBuffer();
  const frames = await Promise.all(['red', 'blue'].map(background => sharp({ create: { width: 32, height: 24, channels: 3, background } }).png().toBuffer()));
  const animation = await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 200] }).toBuffer();
  const paragraphs = 'A quiet place to keep the things that catch your eye. Collections are personal records of curiosity, saved one image or story at a time. '.repeat(12);
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const ratio = pathname.match(/^\/ratio-(\d+)-(\d+)\.svg$/);
    if (ratio) {
      const width = Number(ratio[1]) * 120, height = Number(ratio[2]) * 120;
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="hsl(${(width + height * 3) % 360} 25% 32%)"/><rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="4" fill="none" stroke="#ffffff80" stroke-width="4"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="${Math.min(width, height) / 5}" fill="white">${ratio[1]}:${ratio[2]}</text></svg>`);
    } else if (/\/(red|blue|green)\.svg$/.test(pathname)) {
      const color = pathname.match(/(red|blue|green)/)[1];
      const [width, height] = color === 'red' ? [600, 1200] : color === 'blue' ? [2400, 1200] : [600, 600];
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${color}"/><circle cx="300" cy="250" r="160" fill="#eee" opacity=".3"/><path d="M0 600L250 230L600 600" fill="#111" opacity=".5"/></svg>`);
    } else if (pathname === '/wide.png' || pathname === '/animated.gif') {
      response.writeHead(200, { 'Content-Type': pathname.endsWith('.png') ? 'image/png' : 'image/gif' });
      response.end(pathname.endsWith('.png') ? wideImage : animation);
    } else if ((pathname === '/clip.mp4' || extraVideo && pathname === '/clip-short.mp4') && video) {
      const buffer = await readFile(path.join(dir, path.basename(pathname)));
      const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
      if (range) {
        const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), buffer.length - 1) : buffer.length - 1;
        response.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${buffer.length}`, 'Content-Length': end - start + 1 });
        response.end(buffer.subarray(start, end + 1));
      } else { response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buffer.length }); response.end(buffer); }
    } else if (pathname === '/portrait.mp4') {
      response.writeHead(200, { 'Content-Type': 'video/mp4' });
      response.end(await readFile(new URL('./media/portrait.mp4', import.meta.url)));
    } else if (pathname === '/missing') { response.writeHead(404); response.end(); }
    else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      if (pathname === '/album') response.end(`<html><head><title>Collected colors</title></head><body><article><h1>Collected colors</h1><img src="/red.svg"><img src="/blue.svg"><img src="/green.svg"></article></body></html>`);
      else if (pathname === '/video') response.end('<html><title>A little motion</title><main><video src="/clip.mp4"></video></main></html>');
      else if (pathname === '/mixed') response.end('<html><title>A full video, then an image</title><main><video src="/clip.mp4"></video><img src="/red.svg"></main></html>');
      else if (pathname === '/article') response.end(`<html><title>A place for curiosity</title><article><h1>A place for curiosity</h1><p>${paragraphs}</p></article></html>`);
      else response.end('<html><title>Not media</title><body>This is a page.</body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(dir, { recursive: true, force: true }); } };
}
