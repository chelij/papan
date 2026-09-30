import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileResponse } from '../src/file-response.js';

test('local files provide complete and seekable byte responses without mislabelling partial content', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'papan-ranges-')), file = path.join(dir, 'media.mp4');
  const bytes = Buffer.from('0123456789');
  await writeFile(file, bytes);
  const request = (range, extra = {}) => new Request('papan://media/test', { ...extra, headers: { ...(range ? { Range: range } : {}), ...extra.headers } });
  try {
    for (const [range, start, end] of [[null, 0, 9], ['bytes=0-0', 0, 0], ['bytes=3-5', 3, 5], ['bytes=7-', 7, 9], ['bytes=-3', 7, 9], ['bytes=8-999', 8, 9], ['bytes=-999', 0, 9]]) {
      const response = await fileResponse(file, request(range), 'video/mp4');
      assert.equal(response.status, range ? 206 : 200, range);
      assert.equal(response.headers.get('content-range'), range ? `bytes ${start}-${end}/10` : null);
      assert.equal(response.headers.get('content-length'), String(end - start + 1));
      assert.equal(response.headers.get('accept-ranges'), 'bytes');
      assert.equal(response.headers.get('content-type'), 'video/mp4');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1));
    }
    for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=999999999999999999999999999999-']) {
      const response = await fileResponse(file, request(range), 'video/mp4');
      assert.equal(response.status, 416, range);
      assert.equal(response.headers.get('content-range'), 'bytes */10');
      assert.equal(response.headers.get('content-length'), '0');
      assert.equal(await response.text(), '');
    }
    // Ignore unsupported/malformed or unvalidated conditional ranges, returning
    // the complete file rather than a wrongly labelled partial response.
    for (const input of [request('bytes=broken'), request('bytes=-'), request('bytes=0-1,4-5'), request('items=0-1'), request('bytes=0-1', { headers: { 'If-Range': 'old-version' } })]) {
      const response = await fileResponse(file, input, 'video/mp4');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-range'), null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    const head = await fileResponse(file, request('bytes=1-2', { method: 'HEAD' }), 'video/mp4');
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '10');
    assert.equal(await head.text(), '');
    assert.equal((await fileResponse(dir, request(), 'video/mp4')).status, 404);
    await writeFile(file, '');
    const empty = await fileResponse(file, request(), 'video/mp4');
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get('content-length'), '0');
    assert.equal(await empty.text(), '');
    assert.equal((await fileResponse(file, request('bytes=0-'), 'video/mp4')).status, 416);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
