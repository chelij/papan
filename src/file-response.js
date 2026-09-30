import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

export async function fileResponse(file, request, contentType) {
  const encrypted = typeof file !== 'string';
  const info = encrypted ? file : await stat(file);
  if (!encrypted && !info.isFile()) return new Response('Not found', { status: 404 });
  const headers = new Headers({ 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' });
  if (encrypted) headers.set('Cache-Control', 'no-store');
  let start = 0, end = info.size - 1, status = 200;
  // A file fetch can return a slice with status 200 and no range headers. Serve
  // explicit byte ranges so the player can seek without loading the whole file.
  const range = request.method === 'GET' && /^bytes=(\d*)-(\d*)$/i.exec(request.headers.get('range')?.trim() || '');
  if (range && (range[1] || range[2]) && !request.headers.has('if-range')) {
    start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(end, Number(range[2])) : end;
    if (start > end || start >= info.size) {
      headers.set('Content-Range', `bytes */${info.size}`);
      headers.set('Content-Length', '0');
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }
  headers.set('Content-Length', String(end - start + 1));
  const body = request.method === 'HEAD' || !info.size ? null : Readable.toWeb(encrypted ? Readable.from(file.stream(start, end, request.signal)) : createReadStream(file, { start, end, signal: request.signal }));
  return new Response(body, { status, headers });
}
