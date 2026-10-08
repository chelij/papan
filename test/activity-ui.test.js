import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { newCollection } from '../src/library.js';

test('Activity merges independent download and phone updates and routes recovery to the right queue', async () => {
  const dom = new JSDOM(await readFile('src/renderer/index.html', 'utf8'), { runScripts: 'outside-only', url: 'https://papan.test/' });
  const { window } = dom, $ = id => window.document.getElementById(id), calls = [], collection = newCollection('Inbox');
  let downloadUpdate, phoneUpdate, initialDownloads, failRetry = true;
  const phone = { running: false, devices: [], entries: [
    { id: 'same-id', title: 'https://example.com/mobile', state: 'failed', error: 'Could not download media', createdAt: '2026-10-08T10:00:00Z' },
    { id: 'locked', title: 'protected collection share', state: 'queued', locked: true },
    { id: 'saving', title: 'https://example.com/saving', state: 'running', progress: 'downloading item 2 of 3' },
    { id: 'saved', title: 'https://example.com/saved', state: 'saved' },
  ] };
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.ResizeObserver = window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.showPopover = window.HTMLElement.prototype.hidePopover = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.papan = {
    library: async () => ({ collections: [collection], pins: [] }), onProgress() {},
    downloads: () => new Promise(resolve => { initialDownloads = resolve; }), onDownloads(fn) { downloadUpdate = fn; },
    phoneReceiver: async () => structuredClone(phone), onPhoneInbox(fn) { phoneUpdate = fn; },
    async retryPhoneShare(id) { calls.push(['retryPhoneShare', id]); if (failRetry) { failRetry = false; throw new Error('Unlock the destination collection before retrying.'); } },
    async dismissPhoneShare(id) { calls.push(['dismissPhoneShare', id]); },
    async cancelDownload(id) { calls.push(['cancelDownload', id]); },
    async retryDownload(id) { calls.push(['retryDownload', id]); },
    async dismissDownload(id) { calls.push(['dismissDownload', id]); },
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const action = (name, id) => $('download-list').querySelector(`[data-action="${name}"][data-task="${id}"]`);
  try {
    window.eval(await readFile('src/renderer/app.js', 'utf8'));
    await flush();
    assert.equal($('downloads-toggle').getAttribute('aria-label'), 'Activity');
    assert.equal($('downloads-toggle').hidden, false, 'phone work alone reveals Activity');
    assert.equal($('download-count').textContent, '2');
    assert.equal($('toast').hidden, true, 'startup receipts do not replay notifications');
    assert.ok($('download-list').textContent.includes('waiting for collection unlock'));
    assert.ok($('download-list').textContent.includes('downloading item 2 of 3'));
    assert.equal($('download-list').textContent.includes('https://example.com/saved'), false);
    assert.ok($('phone-entries').textContent.includes('https://example.com/saved'), 'successful phone receipts remain in receiver settings');
    assert.equal(action('dismissPhoneShare', 'saving'), null, 'running shares have no unsupported cancellation');
    initialDownloads([]); await flush();
    assert.equal($('downloads-toggle').hidden, false, 'late download snapshot cannot hide phone work');
    downloadUpdate([{ id: 'same-id', title: 'Extract pose · motion', state: 'running', progress: 'frame 40 of 51', createdAt: '2026-10-08T10:01:00Z' }]);
    assert.equal($('download-count').textContent, '3');
    assert.ok($('download-list').textContent.includes('frame 40 of 51'));
    phone.entries[2].progress = 'building previews'; phoneUpdate(structuredClone(phone));
    assert.ok($('download-list').textContent.includes('building previews'));
    assert.ok($('download-list').textContent.includes('frame 40 of 51'), 'phone progress retains downloads');
    action('cancelDownload', 'same-id').click(); await flush();
    const retry = action('retryPhoneShare', 'same-id'); retry.click(); await flush();
    assert.ok($('toast-message').textContent.includes('Unlock the destination'));
    assert.equal(retry.disabled, false);
    retry.click(); action('dismissPhoneShare', 'locked').click(); await flush();
    assert.deepEqual(calls, [['cancelDownload', 'same-id'], ['retryPhoneShare', 'same-id'], ['retryPhoneShare', 'same-id'], ['dismissPhoneShare', 'locked']]);
    downloadUpdate([{ id: 'same-id', title: 'Download', state: 'cancelled', error: 'Cancelled' }]);
    action('retryDownload', 'same-id').click(); action('dismissDownload', 'same-id').click(); await flush();
    assert.deepEqual(calls.slice(-2), [['retryDownload', 'same-id'], ['dismissDownload', 'same-id']]);
    downloadUpdate([]);
    assert.equal($('downloads-toggle').hidden, false, 'finishing downloads retains unfinished phone work');
    phone.entries = phone.entries.map(entry => ({ ...entry, state: 'saved', locked: false }));
    phoneUpdate(structuredClone(phone)); await flush();
    assert.equal($('downloads-toggle').hidden, true);
    assert.equal($('review-downloads').hidden, true);
    assert.equal($('download-count').textContent, '');
    assert.equal($('download-announcement').textContent, 'saved link from phone');
    phone.entries = [{ id: 'locked', title: 'protected collection share', state: 'failed', locked: true }]; phoneUpdate(structuredClone(phone));
    assert.equal($('downloads-toggle').hidden, false, 'failure remains discoverable without an active count');
    assert.equal($('download-list').textContent.includes('https://example.com/'), false, 'redacted phone snapshots replace previous private titles');
  } finally { window.close(); }
});
