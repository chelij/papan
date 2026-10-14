import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { newCollection } from '../src/library.js';

test('Library startup keeps failed reads distinct from empty boards and retries without duplicate reads', async () => {
  const dom = new JSDOM(await readFile('src/renderer/index.html', 'utf8'), { runScripts: 'outside-only', url: 'https://papan.test/' });
  const { window } = dom, $ = id => window.document.getElementById(id), requests = [];
  let downloadUpdate;
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.ResizeObserver = window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.showPopover = window.HTMLElement.prototype.hidePopover = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.papan = {
    library: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    downloads: async () => [], onDownloads(fn) { downloadUpdate = fn; }, onProgress() {},
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    window.eval(await readFile('src/renderer/app.js', 'utf8'));
    await flush();
    assert.equal($('canvas').getAttribute('aria-busy'), 'true');
    assert.equal($('library-message').textContent, 'loading library…');
    assert.equal($('empty').hidden, true);
    assert.equal($('toolbar').hidden, true);
    for (const key of ['k', 'o', 't']) window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
    const paste = new window.Event('paste', { bubbles: true });
    paste.clipboardData = { getData: () => 'https://example.com/early-link' };
    window.document.body.dispatchEvent(paste);
    assert.equal(window.document.querySelector('dialog[open]'), null);
    assert.equal($('collections').children.length, 0);
    assert.equal(requests.length, 1);

    requests[0].reject(new Error('Library folder is unavailable')); await flush();
    assert.equal($('canvas').getAttribute('aria-busy'), 'false');
    assert.equal($('library-state').hidden, false);
    assert.equal($('library-error').textContent, 'Library folder is unavailable');
    assert.equal($('library-error').getAttribute('role'), 'alert');
    assert.equal($('empty').hidden, true);
    assert.equal($('toast').hidden, true, 'startup errors stay on the board instead of using a timed toast');
    assert.equal($('retry-library').hidden, false);

    $('retry-library').click(); $('retry-library').click(); await flush();
    assert.equal(requests.length, 2);
    assert.equal($('retry-library').disabled, true);
    assert.equal($('library-error').textContent, '');
    assert.equal($('canvas').getAttribute('aria-busy'), 'true');
    requests[1].reject(new Error('Still unavailable')); await flush();
    assert.equal($('library-error').textContent, 'Still unavailable');
    assert.equal($('retry-library').disabled, false);

    $('retry-library').focus(); $('retry-library').click();
    requests[2].resolve({ collections: [], pins: [] }); await flush();
    assert.equal($('library-state').hidden, true);
    assert.equal($('empty').hidden, false, 'only a successfully empty snapshot reveals collecting actions');
    assert.equal($('canvas').getAttribute('aria-busy'), 'false');
    assert.equal(window.document.activeElement, $('start-collecting'));
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    assert.equal($('add-dialog').open, true);
    $('add-dialog').close();

    downloadUpdate([{ id: 'new-download', state: 'completed', title: 'New download' }]); await flush();
    const collection = newCollection('Recovered board');
    requests[3].resolve({ collections: [collection], pins: [] }); await flush();
    assert.equal($('toolbar').hidden, false);
    assert.ok($('collections').textContent.includes('Recovered board'));
    downloadUpdate([{ id: 'later-download', state: 'completed', title: 'Later download' }]); await flush();
    requests[4].reject(new Error('Background read failed')); await flush();
    assert.equal($('library-state').hidden, true);
    assert.equal($('toolbar').hidden, false);
    assert.ok($('collections').textContent.includes('Recovered board'), 'later refresh failures retain the loaded board');
    assert.equal($('toast-message').textContent, 'Background read failed');
  } finally { window.close(); }
});
