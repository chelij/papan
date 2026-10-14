import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { routeSource } from '../src/media.js';

test('SOOP Catch links use the video downloader and reject feeds and lookalike hosts', () => {
  for (const suffix of ['', '/', '?from=share', '/?from=share#video']) {
    assert.equal(routeSource(`https://vod.sooplive.com/player/209648853/catch${suffix}`), 'video');
  }
  for (const pathname of ['/', '/player/id/catch', '/player/123/catchstory', '/player/123/catch/other']) {
    assert.throws(() => routeSource(`https://vod.sooplive.com${pathname}`), /single SOOP Catch video/);
  }
  assert.equal(routeSource('https://vod.sooplive.com.evil.example/player/123/catch'), 'page');
});

test('SOOP Catch uses the existing API downloader with scoped sessions and safe failures', () => {
  const python = path.resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = spawnSync(python, ['test/soop.py'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
