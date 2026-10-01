import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openLibrary } from '../src/library.js';

test('browser-cookie access stays scoped and never exports sessions', () => {
  const python = path.resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = spawnSync(python, ['test/browser_session.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('public extraction precedes browser fallback, and failed downloads restart cleanly', { skip: process.platform === 'win32' }, async () => {
  await mkdir('artifacts', { recursive: true });
  const root = await mkdtemp(path.resolve('artifacts/browser-session-fixture-'));
  try {
    await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'vendor'));
    await writeFile(path.join(root, 'vendor/package.json'), '{"type":"commonjs"}');
    await copyFile('src/media.js', path.join(root, 'src/media.js'));
    const log = path.join(root, 'requests.jsonl');
    await writeFile(path.join(root, 'vendor/papan-extract'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => {
  const r = JSON.parse(input); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({action:r.action,engine:r.engine,browser:r.browser || ''})+'\\n');
  if(r.action==='download') {
    if(!r.browser) { fs.writeFileSync(path.join(r.output,'partial-file'),'partial'); console.log(JSON.stringify({ok:false,error:'login required'})); return; }
    if(fs.readdirSync(r.output).length) throw new Error('partial files were not cleared');
    const file=path.join(r.output,'image.svg'); fs.writeFileSync(file,'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>');
    console.log(JSON.stringify({ok:true,result:[{key:r.keys[0],file}]})); return;
  }
  if(r.url.includes('/status/1') || r.browser) console.log(JSON.stringify({ok:true,result:{title:'fixture',items:[{key:'photo',kind:'image',url:'https://pbs.twimg.com/fixture.jpg'}]}}));
  else console.log(JSON.stringify({ok:false,error:'Unavailable'}));
});
`, { mode: 0o700 });
    const { inspectLink, materialize } = await import(pathToFileURL(path.join(root, 'src/media.js')).href);
    const requests = async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    await inspectLink('https://x.com/user/status/1', undefined, 'auto');
    assert.deepEqual(await requests(), [{ action: 'inspect', engine: 'gallery', browser: '' }], 'public success does not access a browser');
    await writeFile(log, '');
    await assert.rejects(inspectLink('https://x.com/user/status/2'), /public downloader/);
    assert.ok((await requests()).every(request => !request.browser), 'default remains public-only');
    await writeFile(log, '');
    const pin = await inspectLink('https://x.com/user/status/2', undefined, 'auto');
    assert.deepEqual((await requests()).map(r => [r.engine, r.browser]), [['gallery', ''], ['video', ''], ['gallery', 'auto']]);
    await writeFile(log, '');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(inspectLink('https://x.com/user/status/2', controller.signal, 'auto'));
    assert.equal(await readFile(log, 'utf8'), '', 'cancellation never starts authenticated extraction');
    const library = path.join(root, 'library'); await openLibrary(library);
    const saved = await materialize(pin, library, true, undefined, () => {}, 'auto');
    assert.deepEqual((await requests()).map(r => [r.action, r.browser]), [['download', ''], ['download', 'auto']]);
    assert.ok(saved.items[0].localFile && saved.items[0].previewFile);
    assert.deepEqual(await readdir(path.join(library, 'staging')), []);
    assert.ok(!JSON.stringify(saved).includes('firefox'), 'browser choices and session data are not stored in pins');
  } finally { await rm(root, { recursive: true, force: true }); }
});
