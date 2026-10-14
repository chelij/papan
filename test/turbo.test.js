import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { routeSource } from '../src/media.js';

test('Turbo video, download and embed links use the video downloader', () => {
  for (const host of ['turbo.cr', 'www.turbo.cr']) for (const kind of ['d', 'v', 'embed']) {
    assert.equal(routeSource(`https://${host}/${kind}/Skazh7iVsSsYA`), 'video');
    assert.equal(routeSource(`https://${host}/${kind}/-HJNPVqzu4l6s/?ref=share#video`), 'video');
  }
  for (const pathname of ['/', '/a/album', '/v/', '/d/id/other', '/v/not%20an%20id']) {
    assert.throws(() => routeSource(`https://turbo.cr${pathname}`), /single Turbo video/);
  }
  assert.equal(routeSource('https://turbo.cr.evil.example/v/Skazh7iVsSsYA'), 'page');
});

test('Turbo extraction and downloads refresh signed links and enforce limits', () => {
  const python = path.resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = spawnSync(python, ['test/turbo.py'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
