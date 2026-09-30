const $ = id => document.getElementById(id);
const api = window.papan;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const mediaURL = (pin, item, original = false) => item.encrypted || item.previewFile || item.previewPath || item.localFile || item.localPath
  ? `papan://media/${pin.id}/${item.id}/${original ? 'original' : 'preview'}?v=${encodeURIComponent(pin.folder || '')}` : item.url;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let library = { collections: [], pins: [] }, collectionId = null, inspection = null;
let temporaryTabs = [], tabOrder = [];
let selected = new Set(), coverId = null, addRequest = null, settingsRequest = null, settingsOriginal = null;
let creatingCollection = false, shown = 0, filtered = [], viewerPin = null, viewerIndex = 0;
let toastTimer, confirmAction, layoutFrame = 0, gridWidth = 0;
let dragState = null, dragFrame = 0, reorderPending = false;
let pinPreview = null;
let layoutPreview = null;
let collectionFileBusy = false, editingPin = null, undoId = null, exportRequest = null;
let downloadStates = new Map();
let passwordAction = null, passwordCollection = null, passwordReplacementTab = null, passwordBusy = false;
const visible = new Set();
const defaults = { mode: 'online', openAction: 'saved', density: 3, fit: 'contain', motion: true, slideshowSeconds: 4 };
const collection = () => library.collections.find(item => item.id === collectionId) || temporaryTabs.find(item => item.id === collectionId);
const openCollections = () => {
  const tabs = [...library.collections.filter(item => !item.closed), ...temporaryTabs];
  return tabOrder.map(id => tabs.find(item => item.id === id)).filter(Boolean).concat(tabs.filter(item => !tabOrder.includes(item.id)));
};
const settings = () => layoutPreview || collection()?.settings || defaults;
const motion = () => settings().motion && !reducedMotion.matches && !document.hidden && !document.querySelector('dialog[open]:not(#settings-dialog)') && !($('settings-dialog').open && creatingCollection);

function toast(message, removalId = null) {
  clearTimeout(toastTimer);
  $('toast-message').textContent = message;
  undoId = removalId; $('undo-remove').hidden = !removalId;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, removalId ? 10000 : 4500);
}

function errorAt(id, error) { $(id).textContent = error.message || String(error); }

async function refresh(preferred, replacementTab = null) {
  library = await api.library();
  const open = openCollections(), unlocked = open.filter(item => !item.locked);
  tabOrder = open.map(item => item.id);
  collectionId = [preferred, collectionId, unlocked[0]?.id].find(id => unlocked.some(item => item.id === id)) || null;
  render();
  if (library.protectionWarning) toast(library.protectionWarning);
  if (open.some(item => item.id === preferred && item.locked)) openPassword('unlock', preferred, replacementTab);
}

function render() {
  $('toolbar').hidden = !library.collections.length && !temporaryTabs.length;
  document.body.classList.toggle('has-collections', !$('toolbar').hidden);
  const open = openCollections(), tabStop = collectionId || open[0]?.id;
  $('collections').innerHTML = open.map(item => `<div class="collection-entry" role="presentation" data-collection-id="${escapeHTML(item.id)}"><button type="button" class="collection-tab" role="tab" draggable="true" aria-describedby="reorder-help" id="collection-tab-${escapeHTML(item.id)}" data-collection-id="${escapeHTML(item.id)}" aria-selected="${item.id === collectionId}" aria-controls="canvas" tabindex="${item.id === tabStop ? 0 : -1}" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}${item.locked ? ' <span aria-label="locked">· locked</span>' : ''}</button><button type="button" class="collection-close" data-close-collection="${escapeHTML(item.id)}" aria-label="Close ${escapeHTML(item.name)}" title="Close collection" tabindex="${item.id === tabStop ? 0 : -1}">×</button></div>`).join('');
  if (collectionId) {
    $('canvas').setAttribute('role', 'tabpanel');
    $('canvas').setAttribute('aria-labelledby', `collection-tab-${collectionId}`);
    $('canvas').tabIndex = 0;
    $('collections').querySelector('[aria-selected="true"]')?.closest('.collection-entry').scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } else {
    for (const name of ['role', 'aria-labelledby', 'tabindex']) $('canvas').removeAttribute(name);
  }
  $('storage-mode').textContent = collectionId ? settings().mode : '';
  $('lock-collection').hidden = !collection()?.protected || collection().locked;
  for (const id of ['collection-settings', 'save-collection-file']) $(id).disabled = !collection() || collection().temporary || collectionFileBusy;
  $('toggle-search').disabled = !library.collections.length || collectionFileBusy;
  $('grid').dataset.fit = settings().fit;
  const query = $('search').value.trim().toLowerCase(), all = $('search-scope').value === 'all';
  const candidates = library.pins.filter(pin => all || pin.collectionId === collectionId);
  const source = $('search-source').value, tag = $('search-tag').value;
  const sources = [...new Set(candidates.map(pin => new URL(pin.sourceUrl).hostname.replace(/^www\./, '')))].sort();
  const tags = [...new Set(candidates.flatMap(pin => (pin.tags || []).map(tag => tag.toLowerCase())))].sort();
  $('search-source').innerHTML = '<option value="">any source</option>' + sources.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('');
  $('search-tag').innerHTML = '<option value="">any tag</option>' + tags.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('');
  $('search-source').value = sources.includes(source) ? source : '';
  $('search-tag').value = tags.includes(tag) ? tag : '';
  const kind = $('search-kind').value, activeSource = $('search-source').value, activeTag = $('search-tag').value;
  const hasFilter = Boolean(query || kind || activeSource || activeTag);
  $('open-empty-collection').hidden = hasFilter;
  $('grid').dataset.scope = all && hasFilter ? 'all' : 'collection';
  $('toggle-search').classList.toggle('has-filter', hasFilter);
  filtered = candidates.filter(pin => (hasFilter || pin.collectionId === collectionId) && (!query || `${pin.title} ${pin.author || ''} ${pin.text || ''} ${pin.sourceUrl} ${pin.notes || ''} ${(pin.tags || []).join(' ')} ${pin.items.filter(item => item.kind === 'text').map(item => item.text).join(' ')}`.toLowerCase().includes(query)) &&
    (!kind || pin.items.some(item => item.kind === kind)) &&
    (!activeSource || new URL(pin.sourceUrl).hostname.replace(/^www\./, '') === activeSource) &&
    (!activeTag || (pin.tags || []).some(tag => tag.toLowerCase() === activeTag)));
  $('search-summary').hidden = !hasFilter;
  $('search-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'result' : 'results'} · ${all ? 'all unlocked collections, including closed tabs' : collection()?.name || 'this collection'}`;
  $('empty').hidden = filtered.length > 0;
  $('start-collecting').textContent = hasFilter ? 'nothing here matches those filters' : 'paste link to start collecting';
  $('start-collecting').disabled = hasFilter;
  $('start-collecting').setAttribute('aria-label', $('start-collecting').textContent);
  $('grid').hidden = !filtered.length;
  for (const card of $('grid').children) { pause(card); card._cancelSizing?.(); card._loading?.removeAttribute('src'); }
  visible.clear();
  observer.disconnect();
  $('grid').replaceChildren();
  shown = 0;
  appendPins();
  if ($('collections-dialog').open) renderCollectionBrowser();
}

function itemRatio(item) {
  const width = item.previewWidth || item.width, height = item.previewHeight || item.height;
  const ratio = width / height;
  return width > 0 && height > 0 && Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

function albumRatio(items) {
  const ratios = items.filter(item => item.kind !== 'text').map(itemRatio).filter(ratio => ratio !== null).sort((a, b) => a - b);
  if (!ratios.length) return 1;
  const middle = Math.floor(ratios.length / 2);
  // A median in log space favors common proportions and balances wide/tall ties.
  return ratios.length % 2 ? ratios[middle] : Math.sqrt(ratios[middle - 1]) * Math.sqrt(ratios[middle]);
}

async function prepareAlbum(card) {
  card._sizing = true;
  const cancel = [];
  card._cancelSizing = () => cancel.forEach(finish => finish());
  await Promise.all(card._slides.filter(item => item.kind !== 'text' && !itemRatio(item)).map(item => new Promise(resolve => {
    const media = document.createElement(item.kind === 'video' ? 'video' : 'img');
    let timer, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const width = media.videoWidth || media.naturalWidth, height = media.videoHeight || media.naturalHeight;
      if (width > 0 && height > 0) { item.previewWidth = width; item.previewHeight = height; }
      media.onloadedmetadata = media.onload = media.onerror = null;
      media.removeAttribute('src');
      if (item.kind === 'video') media.load();
      resolve();
    };
    cancel.push(finish);
    media.preload = 'metadata';
    media.onloadedmetadata = media.onload = media.onerror = finish;
    timer = setTimeout(finish, 5000);
    const source = mediaURL(card._pin, item);
    if (source) media.src = source; else finish();
  })));
  card._sized = true; card._sizing = false; card._cancelSizing = null;
  if (!card.isConnected) return;
  card._ratio = albumRatio(card._slides);
  scheduleLayout();
  if (visible.has(card)) showSlide(card);
}

function appendPins() {
  const next = filtered.slice(shown, shown + 48);
  for (const pin of next) {
    const card = document.createElement('article');
    card.className = 'pin';
    card.draggable = $('grid').dataset.scope !== 'all';
    card.setAttribute('role', 'listitem');
    card.dataset.pinId = pin.id;
    card._pin = pin;
    const visual = pin.items.filter(item => item.kind !== 'text');
    card._slides = pin.previews ? pin.previews.map(preview => pin.items.find(item => item.id === preview.itemId)) : visual.length ? visual : pin.items;
    card.classList.toggle('album', card._slides.length > 1);
    card._index = Math.max(0, card._slides.findIndex(item => item.id === pin.coverId));
    card._ratio = albumRatio(card._slides);
    card._sized = card._slides.length < 2 || card._slides.every(item => item.kind === 'text' || itemRatio(item));
    card._last = Date.now();
    const domain = new URL(pin.sourceUrl).hostname.replace(/^www\./, '');
    card.innerHTML = `<button class="tile-main" aria-label="${escapeHTML(pin.title)}"><div class="tile-media"></div><span class="tile-overlay"><span class="tile-collection">${$('grid').dataset.scope === 'all' ? escapeHTML(library.collections.find(item => item.id === pin.collectionId)?.name) : ''}</span><span class="tile-title">${escapeHTML(pin.title)}</span><span class="tile-source">${escapeHTML(domain)}</span></span></button><button class="pin-detail" aria-label="Details for ${escapeHTML(pin.title)}" title="View saved items">···</button>${card._slides.length > 1 ? `<span class="album-mark" aria-label="${card._slides.length} slides"><span class="slide-dot active"></span>${'<span class="slide-dot"></span>'.repeat(Math.min(card._slides.length - 1, 5))}<span class="album-count">${card._slides.length}</span></span>` : ''}`;
    card.querySelector('.tile-main').onclick = () => openViewer(pin);
    card.querySelector('.tile-main').setAttribute('aria-describedby', 'reorder-help');
    card.querySelector('.pin-detail').onclick = () => openViewer(pin);
    $('grid').append(card);
    observer.observe(card);
  }
  shown += next.length;
  $('sentinel').hidden = shown >= filtered.length;
  $('end-note').hidden = !filtered.length || shown < filtered.length;
  $('end-note').textContent = `${filtered.length} ${filtered.length === 1 ? 'pin' : 'pins'} · keep collecting`;
  scheduleLayout();
}

function scheduleLayout() {
  if (!layoutFrame) layoutFrame = requestAnimationFrame(layoutPins);
}

function layoutPins() {
  layoutFrame = 0;
  const grid = $('grid'), gap = 8, padding = 12;
  const width = grid.clientWidth - padding * 2;
  if (grid.hidden || width <= 0) return;
  const cards = [...grid.children];
  if (pinPreview) {
    const index = cards.findIndex(card => card.dataset.pinId === pinPreview.id);
    if (index !== -1) {
      const [moving] = cards.splice(index, 1);
      const before = cards.findIndex(card => card.dataset.pinId === pinPreview.beforeId);
      cards.splice(before === -1 ? cards.length : before, 0, moving);
    }
  }
  const ratios = cards.map(card => settings().fit === 'cover' ? 1 : card._ratio);
  // Default density aims for 360px rows; narrower windows naturally fit fewer items.
  const targetHeight = Math.min(width, 1080 / settings().density);
  let start = 0, top = padding;
  while (start < cards.length) {
    let end = start, sum = 0;
    while (end < cards.length) {
      if (end > start && width - gap * (end - start) <= 0) break;
      const nextHeight = (width - gap * (end - start)) / (sum + ratios[end]);
      const previousHeight = (width - gap * (end - start - 1)) / sum;
      if (end > start && nextHeight <= targetHeight && Math.abs(previousHeight - targetHeight) < Math.abs(nextHeight - targetHeight)) break;
      sum += ratios[end++];
      if (nextHeight <= targetHeight) break;
    }
    const fittedHeight = (width - gap * (end - start - 1)) / sum;
    const height = Math.min(fittedHeight, targetHeight * (end === cards.length ? 1 : 1.5));
    let left = padding;
    for (let index = start; index < end; index++) {
      const tileWidth = height * ratios[index];
      Object.assign(cards[index].style, { left: `${left}px`, top: `${top}px`, width: `${tileWidth}px`, height: `${height}px` });
      left += tileWidth + gap;
    }
    top += height + gap;
    start = end;
  }
  grid.style.height = `${cards.length ? top - gap + padding : 0}px`;
  requestAnimationFrame(loadNearEnd);
}

function rememberDimensions(card, item, width, height) {
  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  item.previewWidth = width;
  item.previewHeight = height;
  // An album's shared frame stays fixed as its slides change.
  if (card._slides.length === 1 && Math.abs(card._ratio - ratio) > 0.001) { card._ratio = ratio; scheduleLayout(); }
}

new ResizeObserver(() => {
  const width = $('grid').clientWidth;
  if (width !== gridWidth) { gridWidth = width; scheduleLayout(); }
}).observe($('grid'));

async function showSlide(card) {
  const item = card._slides[card._index];
  const target = card.querySelector('.tile-media');
  const source = mediaURL(card._pin, item);
  pause(card);
  if (item.kind === 'text') {
    target.innerHTML = `<div class="text-tile"><span class="text-mark">Aa</span><h2>${escapeHTML(card._pin.title)}</h2><p>${escapeHTML(item.text)}</p></div>`;
  } else if (item.kind === 'video') {
    const video = document.createElement('video');
    const preview = card._pin.previews?.find(preview => preview.itemId === item.id);
    video.src = source || '';
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = Boolean(motion());
    video.loop = card._slides.length === 1 && !preview;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-label', card._pin.title);
    let start = preview?.start || 0;
    video.addEventListener('loadedmetadata', () => {
      rememberDimensions(card, item, video.videoWidth, video.videoHeight);
      if (start >= video.duration) start = 0;
      if (start) video.currentTime = start;
    });
    if (preview) {
      video.addEventListener('timeupdate', () => {
        if (card._loading || !video.isConnected || preview.end == null || video.currentTime < preview.end || video.seeking) return;
        if (card._slides.length > 1) {
          video.pause();
          if (motion()) { card._index = (card._index + 1) % card._slides.length; showSlide(card); }
        } else video.currentTime = start;
      });
      video.addEventListener('ended', () => {
        if (card._slides.length !== 1) return;
        video.currentTime = start;
        if (visible.has(card) && motion()) video.play().catch(() => {});
      });
    }
    target.replaceChildren(video);
    video.addEventListener('error', () => mediaError(target, 'video preview unavailable'));
    if (motion()) video.play().catch(() => {});
  } else {
    const img = document.createElement('img');
    img.draggable = false;
    img.src = source || '';
    img.alt = item.alt || card._pin.title;
    img.decoding = 'async';
    // Keep the displayed frame until the replacement is ready to paint.
    card._loading = img;
    const decoded = await img.decode().then(() => true, () => false);
    if (card._loading !== img) return;
    card._loading = null;
    if (!card.isConnected) return;
    if (!decoded) {
      if (!target.querySelector('img')) mediaError(target, 'image unavailable');
      card._last = Date.now();
      card._loaded = true;
      return;
    }
    rememberDimensions(card, item, img.naturalWidth, img.naturalHeight);
    target.replaceChildren(img);
  }
  card.querySelectorAll('.slide-dot').forEach((dot, index) => dot.classList.toggle('active', index === card._index % 6));
  card._last = Date.now();
  card._loaded = true;
}

function mediaError(target, message) {
  const fallback = document.createElement('span');
  fallback.className = 'media-error';
  fallback.textContent = message;
  target.replaceChildren(fallback);
}

function pause(card) { card.querySelector('video')?.pause(); }

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const card = entry.target;
    if (entry.isIntersecting) {
      visible.add(card);
      if (!card._loaded && !card._sizing && !card._loading) {
        if (card._sized) showSlide(card); else prepareAlbum(card);
      }
      if (motion() && !card._loading) card.querySelector('video')?.play().catch(() => {});
      card._last = Date.now();
    } else {
      visible.delete(card);
      pause(card);
      const video = card.querySelector('video');
      if (video) { video.removeAttribute('src'); video.load(); card._loaded = false; }
    }
  }
}, { threshold: 0.05 });

function loadNearEnd() {
  if (shown < filtered.length && $('sentinel').getBoundingClientRect().top < innerHeight + 700) appendPins();
}
window.addEventListener('scroll', loadNearEnd, { passive: true });
window.addEventListener('resize', () => {
  scheduleLayout();
  $('collections').querySelector('[aria-selected="true"]')?.closest('.collection-entry').scrollIntoView({ block: 'nearest', inline: 'nearest' });
});

setInterval(() => {
  if (!motion()) { for (const card of visible) pause(card); return; }
  const now = Date.now();
  for (const card of visible) {
    if (card._sizing || card._loading) continue;
    const video = card.querySelector('video');
    if (card._slides.length > 1 && (video ? video.ended : now - card._last >= settings().slideshowSeconds * 1000)) {
      card._index = (card._index + 1) % card._slides.length;
      showSlide(card);
    } else video?.play().catch(() => {});
  }
}, 400);

function toastError(error) { toast(error.message || String(error)); }

function openAdd(link = '', inspect = false) {
  if (collection()?.locked) { openPassword('unlock'); return; }
  if ($('add-dialog').open) return;
  inspection = null;
  selected.clear();
  $('inspection').hidden = true;
  $('link-input').value = link;
  $('pin-tags').value = ''; $('pin-notes').value = '';
  document.querySelector('.pin-metadata').open = false;
  $('add-error').textContent = '';
  $('add-status').textContent = '';
  $('add-dialog').showModal();
  $('link-input').focus();
  if (inspect) findMedia();
}

function busyAdd(busy) {
  $('inspect-button').disabled = busy;
  $('save-pin').disabled = busy || !selected.size;
  $('link-input').disabled = busy;
  $('select-all').disabled = busy;
  $('save-collection').disabled = busy;
  for (const input of $('media-picker').querySelectorAll('input')) input.disabled = busy;
}

async function findMedia() {
  if (addRequest || !$('link-input').value.trim()) return;
  const requestId = crypto.randomUUID();
  addRequest = requestId;
  $('inspection').hidden = true;
  $('add-error').textContent = '';
  $('add-status').textContent = 'finding public media…';
  busyAdd(true);
  try {
    const data = await api.inspect({ url: $('link-input').value.trim(), requestId });
    if (addRequest !== requestId || !$('add-dialog').open) return;
    inspection = data;
    const media = data.items.filter(item => item.kind !== 'text');
    selected = new Set((media.length ? media : data.items).map(item => item.id));
    coverId = [...selected][0];
    $('source-domain').textContent = new URL(data.sourceUrl).hostname;
    $('pin-title').value = data.title;
    const destinations = library.collections.filter(item => !item.closed && !item.locked);
    $('save-collection-row').hidden = !destinations.length;
    $('save-collection').innerHTML = ((!collectionId || collection().temporary) ? '<option value="">new collection</option>' : '') + destinations.map(item => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join('');
    $('save-collection').value = collection()?.temporary ? '' : collectionId || '';
    $('save-hint').textContent = collection()?.temporary || !collectionId ? 'a new collection will be created when you add this link' : 'only selected items will be saved';
    renderPicker();
    $('inspection').hidden = false;
    $('add-status').textContent = '';
  } catch (error) { if (addRequest === requestId) errorAt('add-error', error); }
  finally { if (addRequest === requestId) { addRequest = null; busyAdd(false); if ($('add-error').textContent) $('add-status').textContent = ''; } }
}

function renderPicker() {
  $('media-picker').innerHTML = inspection.items.map((item, index) => {
    const src = item.kind === 'video' ? item.poster : item.url;
    const visual = item.kind === 'text' ? `<div class="picker-text">${escapeHTML(item.text?.slice(0, 350))}</div>` : src ? `<img src="${escapeHTML(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="picker-text video-symbol">▷</div>';
    return `<div class="picker-item ${selected.has(item.id) ? 'selected' : ''}"><label class="picker-choose"><input type="checkbox" value="${item.id}" aria-label="Select ${item.kind} ${index + 1}" ${selected.has(item.id) ? 'checked' : ''}>${visual}<span class="picker-type">${item.kind} ${index + 1}</span></label><label class="cover-control" title="Use as cover"><input type="radio" name="cover" value="${item.id}" aria-label="Use item ${index + 1} as cover" ${coverId === item.id ? 'checked' : ''}> cover</label></div>`;
  }).join('');
  $('selection-count').textContent = `${selected.size} selected`;
  $('save-pin').disabled = !selected.size;
}

$('media-picker').addEventListener('change', event => {
  const input = event.target;
  if (input.type === 'checkbox') {
    input.checked ? selected.add(input.value) : selected.delete(input.value);
    if (!selected.has(coverId)) coverId = [...selected][0];
  } else { coverId = input.value; selected.add(coverId); }
  renderPicker();
});

$('select-all').onclick = () => {
  selected = new Set(selected.size === inspection.items.length ? [] : inspection.items.map(item => item.id));
  coverId = [...selected][0];
  renderPicker();
};

$('save-pin').onclick = async () => {
  if (addRequest || !inspection || !selected.size) return;
  const requestId = crypto.randomUUID();
  addRequest = requestId;
  busyAdd(true);
  $('add-error').textContent = '';
  $('add-status').textContent = 'saving your collection…';
  try {
    const temporaryId = collection()?.temporary ? collectionId : null, target = $('save-collection').value || null;
    const saved = await api.enqueueSave({ inspectionId: inspection.id, selectedIds: [...selected], coverId,
      collectionId: target, newCollection: !target, title: $('pin-title').value, tags: $('pin-tags').value.split(',').map(tag => tag.trim()).filter(Boolean), notes: $('pin-notes').value });
    if (temporaryId) {
      temporaryTabs = temporaryTabs.filter(item => item.id !== temporaryId);
      tabOrder = tabOrder.filter(id => id !== saved.collectionId).map(id => id === temporaryId ? saved.collectionId : id);
    }
    addRequest = null;
    $('add-dialog').close();
    await refresh(saved.collectionId);
    toast('saving in the background · keep collecting');
  } catch (error) { if ($('add-dialog').open) errorAt('add-error', error); }
  finally { if (addRequest === requestId) addRequest = null; busyAdd(false); $('add-status').textContent = ''; }
};

$('preview-size').oninput = () => {
  $('size-value').value = $('preview-size').value;
  $('preview-size').setAttribute('aria-valuetext', `${$('preview-size').value} of 10`);
};
$('slide-seconds').oninput = () => {
  $('slideshow-value').value = `${$('slide-seconds').value} s`;
  $('slide-seconds').setAttribute('aria-valuetext', `${$('slide-seconds').value} ${$('slide-seconds').value === '1' ? 'second' : 'seconds'}`);
};
$('settings-form').addEventListener('input', event => {
  if (creatingCollection || !$('settings-dialog').open || !['preview-size', 'media-fit', 'slide-seconds', 'motion'].includes(event.target.id)) return;
  layoutPreview = { ...collection().settings, density: 11 - Number($('preview-size').value), fit: $('media-fit').value,
    slideshowSeconds: Number($('slide-seconds').value), motion: $('motion').checked };
  $('grid').dataset.fit = settings().fit;
  scheduleLayout();
  for (const card of visible) {
    const video = card.querySelector('video');
    if (motion() && !card._loading) video?.play().catch(() => {}); else video?.pause();
    if (['slide-seconds', 'motion'].includes(event.target.id)) card._last = Date.now();
  }
});

function showSettingsSection(section) {
  for (const tab of $('settings-tabs').querySelectorAll('[role="tab"]')) {
    const active = tab.dataset.settingsSection === section;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !active;
  }
  $('settings-form').scrollTop = 0;
}
$('settings-tabs').onclick = event => {
  const tab = event.target.closest('[data-settings-section]');
  if (tab) showSettingsSection(tab.dataset.settingsSection);
};
$('settings-tabs').onkeydown = event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...$('settings-tabs').querySelectorAll('[role="tab"]')].filter(tab => !tab.hidden);
  const index = tabs.indexOf(document.activeElement);
  if (index === -1) return;
  event.preventDefault();
  const target = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  showSettingsSection(target.dataset.settingsSection); target.focus();
};

function openSettings(create = false) {
  if (!create && collection()?.temporary) return;
  if (!create && collection()?.locked) { openPassword('unlock'); return; }
  creatingCollection = create;
  layoutPreview = null;
  const current = create ? { name: '', settings: defaults } : collection();
  if (!current) return;
  settingsOriginal = create ? null : structuredClone(current);
  $('settings-title').textContent = create ? 'a new collection' : 'collection settings';
  $('collection-name').value = current.name;
  $('collection-name').placeholder = 'name this corner of the internet';
  $('collection-mode').value = current.settings.mode;
  // Keep the saved density format so existing collections retain their layout.
  $('preview-size').value = 11 - current.settings.density;
  $('media-fit').value = current.settings.fit;
  $('slide-seconds').value = current.settings.slideshowSeconds;
  $('preview-size').oninput();
  $('slide-seconds').oninput();
  $('motion').checked = current.settings.motion;
  $('delete-collection').hidden = create;
  $('tools-info').hidden = create;
  $('collection-storage').hidden = create;
  $('collection-protection').hidden = create;
  $('settings-tab-privacy').hidden = create;
  $('settings-autosave').hidden = create;
  $('protection-state').textContent = current.protected ? 'encrypted' : 'off';
  $('protection-state').dataset.protected = String(Boolean(current.protected));
  $('protection-summary').textContent = current.protected ? 'Contents and saved media are encrypted. Use the toolbar padlock or close the tab to lock them.' : 'Encrypt this collection’s contents and saved media with its own password.';
  $('manage-protection').textContent = current.protected ? 'change password…' : 'protect collection…';
  $('remove-protection').hidden = !current.protected;
  $('storage-heading').textContent = current.protected ? 'encrypted collection' : 'saved collection list';
  $('collection-file-hint').textContent = current.protected ? 'Includes encrypted media and updates automatically.' : 'Auto-updates the pin list. Media stays on this device.';
  $('collection-export-hint').textContent = current.protected ? 'Encrypted media and metadata. Open with the same password on another device.' : 'Bundle previews, downloaded originals, tags, and notes for another device.';
  $('collection-destination').textContent = current.destination || 'saved in Papan';
  $('collection-destination').title = current.destination || 'No external destination chosen yet.';
  $('choose-destination').textContent = current.destination ? 'save as…' : 'choose file…';
  $('library-folder').textContent = current.destination ? 'open destination folder ↗' : 'open local library folder ↗';
  $('create-collection').hidden = !create;
  $('discard-settings').hidden = true;
  $('settings-error').textContent = '';
  $('settings-status').textContent = '';
  $('settings-dialog').classList.toggle('preview-settings', !create);
  $('layout-preview-hint').hidden = create;
  for (const details of $('settings-dialog').querySelectorAll('details')) details.open = false;
  showSettingsSection('general');
  $('settings-dialog').showModal();
  if (create) $('collection-name').focus();
  else api.tools().then(versions => { $('tool-versions').textContent = `gallery-dl ${versions['gallery-dl']} · yt-dlp ${versions['yt-dlp']} · Instaloader ${versions.Instaloader}`; }).catch(error => { $('tool-versions').textContent = error.message; });
}

$('settings-form').onsubmit = async event => {
  event.preventDefault();
  if (settingsRequest || !$('settings-form').reportValidity()) return;
  const requestId = crypto.randomUUID();
  const input = { id: settingsOriginal?.id, requestId, name: $('collection-name').value, settings: {
    mode: $('collection-mode').value, openAction: 'saved', density: 11 - Number($('preview-size').value), fit: $('media-fit').value,
    motion: $('motion').checked, slideshowSeconds: Number($('slide-seconds').value),
  } };
  if (!creatingCollection && input.name.trim() === settingsOriginal.name && Object.keys(input.settings).every(key => input.settings[key] === settingsOriginal.settings[key])) {
    $('settings-dialog').close();
    return;
  }
  settingsRequest = requestId;
  $('settings-error').textContent = '';
  $('settings-status').textContent = 'saving collection…';
  for (const control of $('settings-form').elements) control.disabled = true;
  try {
    const forPin = creatingCollection && $('pin-editor').open;
    const background = !creatingCollection && input.settings.mode === 'offline' && library.pins.some(pin => pin.collectionId === input.id && !pin.offline);
    const result = await (creatingCollection ? api.createCollection(input) : background ? api.enqueueCollection(input) : api.updateCollection(input));
    if (!forPin) $('search').value = '';
    await refresh(forPin ? collectionId : background ? input.id : result.id);
    if (forPin) {
      const select = $('edit-collection');
      select.add(new Option(result.name, result.id), select.options.length - 1);
      select.value = result.id;
      select.onchange();
    }
    settingsRequest = null;
    $('settings-dialog').close();
    if (background) toast('downloading originals in the background');
  } catch (error) {
    if ($('settings-dialog').open) { errorAt('settings-error', error); $('discard-settings').hidden = creatingCollection; }
  }
  finally {
    settingsRequest = null;
    for (const control of $('settings-form').elements) control.disabled = false;
    $('settings-status').textContent = '';
  }
};

function closeSettings() {
  if (settingsRequest) return;
  if (creatingCollection) $('settings-dialog').close();
  else $('settings-form').requestSubmit();
}

$('settings-form').addEventListener('invalid', event => {
  const section = event.target.closest('[data-settings-panel]')?.dataset.settingsPanel;
  if (section) showSettingsSection(section);
  $('discard-settings').hidden = creatingCollection;
}, true);
$('discard-settings').onclick = () => $('settings-dialog').close();
$('settings-dialog').addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });

function openViewer(pin) {
  viewerPin = pin;
  viewerIndex = Math.max(0, pin.items.findIndex(item => item.id === pin.coverId));
  $('viewer-title').textContent = pin.title;
  $('viewer-source').textContent = `${pin.author ? `${pin.author} · ` : ''}${new URL(pin.sourceUrl).hostname} · ${pin.offline ? 'originals saved on this device' : 'cached previews · videos are silent'}`;
  $('viewer-details').innerHTML = `<div class="tag-list">${(pin.tags || []).map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join('')}</div>${pin.notes ? `<p class="viewer-notes">${escapeHTML(pin.notes)}</p>` : ''}`;
  $('viewer').showModal();
  renderViewer();
}

function renderViewer() {
  $('viewer-media').querySelector('video')?.pause();
  const item = viewerPin.items[viewerIndex];
  const source = mediaURL(viewerPin, item, true);
  if (item.kind === 'text') {
    const text = document.createElement('div');
    text.className = 'article-body';
    text.textContent = item.text;
    $('viewer-media').replaceChildren(text);
  } else {
    const media = document.createElement(item.kind === 'video' ? 'video' : 'img');
    media.src = source || '';
    if (item.kind === 'video') { media.controls = true; media.autoplay = true; media.muted = true; media.playsInline = true; }
    else media.alt = item.alt || viewerPin.title;
    media.addEventListener('error', () => mediaError($('viewer-media'), 'this saved media could not be opened'));
    $('viewer-media').replaceChildren(media);
  }
  $('viewer-position').textContent = `${viewerIndex + 1} / ${viewerPin.items.length}`;
  $('viewer-prev').disabled = viewerPin.items.length < 2;
  $('viewer-next').disabled = viewerPin.items.length < 2;
}

function confirmRemove(message, action) {
  confirmAction = action;
  $('confirm-message').textContent = message;
  $('confirm-dialog').showModal();
}

$('confirm-cancel').onclick = () => $('confirm-dialog').close();
$('confirm-remove').onclick = async () => {
  $('confirm-remove').disabled = true;
  try { await confirmAction(); $('confirm-dialog').close(); }
  catch (error) { toastError(error); }
  finally { $('confirm-remove').disabled = false; }
};
$('remove-pin').onclick = () => confirmRemove('Remove this pin from the collection?', async () => {
  const removalId = await api.deletePin(viewerPin.id); $('viewer').close(); await refresh(); toast('pin removed', removalId);
});
$('delete-collection').onclick = () => confirmRemove(`Remove “${collection().name}” and all of its pins?`, async () => {
  const removalId = await api.deleteCollection(collectionId); $('settings-dialog').close(); await refresh(); toast('collection removed', removalId);
});
$('viewer-prev').onclick = () => { viewerIndex = (viewerIndex + viewerPin.items.length - 1) % viewerPin.items.length; renderViewer(); };
$('viewer-next').onclick = () => { viewerIndex = (viewerIndex + 1) % viewerPin.items.length; renderViewer(); };
$('open-source').onclick = () => api.openSource(viewerPin.id).catch(toastError);
$('library-folder').onclick = () => api.openFolder(collectionId).catch(toastError);

async function saveCollectionFile(chooseDestination = false) {
  if (!collectionId || collection()?.temporary || collectionFileBusy) return;
  const id = collectionId;
  collectionFileBusy = true;
  $('save-collection-file').disabled = $('choose-destination').disabled = true;
  try {
    const saved = await api.saveCollection({ id, chooseDestination });
    if (!saved) return;
    await refresh(saved.id);
    $('collection-destination').textContent = saved.destination;
    $('choose-destination').textContent = 'save as…';
    toast(saved.protected ? 'encrypted collection and media saved' : 'Collection list saved · media stays in its current location');
  } catch (error) { toastError(error); }
  finally {
    collectionFileBusy = false;
    for (const id of ['collection-settings', 'save-collection-file']) $(id).disabled = !collection() || collection().temporary;
    $('toggle-search').disabled = !library.collections.length;
    $('choose-destination').disabled = false;
  }
}

async function closeCollection(id) {
  if (collectionFileBusy || reorderPending) return;
  try {
    const open = openCollections(), index = open.findIndex(item => item.id === id);
    const next = id === collectionId ? [...open.slice(index + 1), ...open.slice(0, index).reverse()].find(item => !item.locked)?.id : collectionId;
    if (temporaryTabs.some(item => item.id === id)) {
      temporaryTabs = temporaryTabs.filter(item => item.id !== id);
      tabOrder = tabOrder.filter(item => item !== id);
      if (id === collectionId) { collectionId = next || null; resetFilters(); }
      render();
      return;
    }
    await api.closeCollection(id);
    if (library.collections.find(item => item.id === id)?.protected) clearPrivateViews();
    if (id === collectionId) $('search').value = '';
    await refresh(next);
    toast('Collection closed · reopen it from Open collection');
  } catch (error) { toastError(error); }
}

function renderCollectionBrowser() {
  const recent = library.collections.filter(item => item.closed && !(library.hiddenRecentCollections || []).includes(item.id));
  const all = $('collection-browser-scope').value === 'all', collections = all ? library.collections : recent;
  $('trash-section').hidden = !library.trash?.length;
  $('removed-items').innerHTML = [...(library.trash || [])].reverse().map(item => `<button class="closed-collection" data-restore="${escapeHTML(item.id)}"><span>${escapeHTML(item.collection?.name || item.pins[0]?.pin.title)}</span><small>restore ${item.collection ? 'collection' : 'pin'} · ${item.pins.length} ${item.pins.length === 1 ? 'pin' : 'pins'}</small></button>`).join('');
  $('closed-collections').innerHTML = collections.length ? collections.map(item => `<button class="closed-collection" data-reopen-collection="${escapeHTML(item.id)}"><span>${escapeHTML(item.name)}</span><small>${!item.closed ? 'open · ' : ''}${item.locked ? 'locked' : `${library.pins.filter(pin => pin.collectionId === item.id).length} pins`} · ${escapeHTML(item.destination || 'saved in Papan')}</small></button>`).join('') : `<p class="hint">${all ? 'no saved collections yet' : 'no recent collections'}</p>`;
  for (const button of $('collections-dialog').querySelectorAll('button:not([data-close])')) button.disabled = collectionFileBusy;
  $('collection-browser-scope').disabled = collectionFileBusy;
  $('clear-collection-history').hidden = all;
  $('clear-collection-history').disabled = collectionFileBusy || !recent.length;
  $('collection-history-hint').hidden = all;
}

function openCollectionBrowser() {
  if (document.querySelector('dialog[open]') || collectionFileBusy) return;
  $('collection-browser-scope').value = 'recent';
  renderCollectionBrowser();
  $('collection-file-status').textContent = '';
  $('collection-file-error').textContent = '';
  $('collections-dialog').showModal();
}

async function openCollectionFile(id) {
  if (collectionFileBusy) return;
  collectionFileBusy = true;
  $('collection-file-error').textContent = '';
  $('collection-file-status').textContent = id ? 'reopening collection…' : 'opening collection…';
  renderCollectionBrowser();
  try {
    const temporaryId = collection()?.temporary ? collectionId : null;
    const opened = await (id ? api.reopenCollection(id) : api.openCollection());
    if (!opened) return;
    $('collections-dialog').close();
    if (!opened.locked) {
      if (temporaryId) {
        temporaryTabs = temporaryTabs.filter(item => item.id !== temporaryId);
        tabOrder = tabOrder.filter(id => id !== opened.id).map(id => id === temporaryId ? opened.id : id);
      }
      resetFilters();
    }
    await refresh(opened.id, temporaryId);
    if (opened.warning) toast(opened.warning);
  } catch (error) { errorAt('collection-file-error', error); }
  finally {
    collectionFileBusy = false;
    $('collection-file-status').textContent = '';
    renderCollectionBrowser();
    for (const id of ['collection-settings', 'save-collection-file']) $(id).disabled = !collection() || collection().temporary;
    $('toggle-search').disabled = !library.collections.length;
  }
}

$('open-collection').onclick = $('open-empty-collection').onclick = openCollectionBrowser;
$('save-collection-file').onclick = () => saveCollectionFile();
$('choose-destination').onclick = () => saveCollectionFile(true);
$('browse-collection').onclick = () => openCollectionFile();
$('collection-browser-scope').onchange = () => { $('collection-file-status').textContent = ''; renderCollectionBrowser(); };
$('clear-collection-history').onclick = async () => {
  if (collectionFileBusy || $('clear-collection-history').disabled) return;
  collectionFileBusy = true;
  $('collection-file-error').textContent = '';
  $('collection-file-status').textContent = 'clearing history…';
  renderCollectionBrowser();
  try {
    await api.clearCollectionHistory();
    await refresh();
    $('collection-file-status').textContent = 'History cleared. Your saved collections are still in all collections.';
  } catch (error) { $('collection-file-status').textContent = ''; errorAt('collection-file-error', error); }
  finally { collectionFileBusy = false; render(); if ($('collections-dialog').open) $('collection-browser-scope').focus(); }
};
$('closed-collections').onclick = event => { const button = event.target.closest('[data-reopen-collection]'); if (button) openCollectionFile(button.dataset.reopenCollection); };

async function reorderItem(kind, id, beforeId) {
  if (reorderPending || id === beforeId) return;
  reorderPending = true;
  try {
    if (kind === 'collection') {
      const tabs = openCollections().filter(item => item.id !== id);
      const moving = openCollections().find(item => item.id === id);
      if (!moving || beforeId !== null && !tabs.some(item => item.id === beforeId)) throw new Error('This tab no longer exists.');
      tabs.splice(beforeId === null ? tabs.length : tabs.findIndex(item => item.id === beforeId), 0, moving);
      const following = tabs.slice(tabs.indexOf(moving) + 1).find(item => !item.temporary);
      if (!moving.temporary) library = await api.reorder({ kind, id, beforeId: following?.id || null });
      tabOrder = tabs.map(item => item.id);
    } else library = await api.reorder({ kind, id, beforeId });
    const container = $(kind === 'pin' ? 'grid' : 'collections');
    const focused = document.activeElement, scroll = container.scrollLeft;
    const nodes = new Map([...container.children].map(node => [kind === 'pin' ? node.dataset.pinId : node.dataset.collectionId, node]));
    const items = kind === 'pin' ? library.pins : openCollections();
    if (nodes.has(id)) {
      const following = items.slice(items.findIndex(item => item.id === id) + 1).find(item => nodes.has(item.id));
      container.insertBefore(nodes.get(id), nodes.get(following?.id) || null);
    }
    container.scrollLeft = scroll;
    if (container.contains(focused)) focused.focus({ preventScroll: true });
    if (kind === 'pin') {
      const matches = new Set(filtered.map(pin => pin.id));
      filtered = library.pins.filter(pin => matches.has(pin.id));
      scheduleLayout();
    } else nodes.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!temporaryTabs.some(item => item.id === id)) toast('Order saved');
  } catch (error) { toastError(error); }
  finally {
    reorderPending = false;
    if (kind === 'pin') { pinPreview = null; scheduleLayout(); }
  }
}

function endDrag(keepPreview = false) {
  cancelAnimationFrame(dragFrame);
  if (dragState?.kind === 'pin') {
    dragState.container.style.minHeight = '';
    if (!keepPreview) pinPreview = null;
    scheduleLayout();
  }
  dragState?.node.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  $('drop-marker').hidden = true;
  $('collections').querySelector('.drop-target')?.classList.remove('drop-target');
  dragState = null;
}

function updateDrop() {
  const marker = $('drop-marker');
  marker.hidden = true;
  if (!dragState) return;
  const { container, kind, x, y, node } = dragState;
  dragState.beforeId = undefined;
  dragState.targetCollectionId = undefined;
  $('collections').querySelector('.drop-target')?.classList.remove('drop-target');
  if (kind === 'pin') {
    const target = document.elementFromPoint(x, y)?.closest('.collection-entry');
    if (target && !temporaryTabs.some(item => item.id === target.dataset.collectionId) && target.dataset.collectionId !== node._pin.collectionId) {
      dragState.targetCollectionId = target.dataset.collectionId;
      target.classList.add('drop-target');
      return;
    }
  }
  const bounds = container.getBoundingClientRect(), toolbarBottom = $('toolbar').getBoundingClientRect().bottom;
  if (x < bounds.left || x > bounds.right || y < Math.max(bounds.top, kind === 'pin' ? toolbarBottom : 0) || y > Math.min(bounds.bottom, innerHeight)) return;
  if (kind === 'pin') {
    const point = [x, y, scrollX, scrollY, container.clientWidth, container.children.length].join(':');
    // Reflow must not pick another target underneath a stationary pointer.
    if (point === dragState.point) { dragState.beforeId = pinPreview.beforeId; return; }
    dragState.point = point;
  }
  let target, nearest = Infinity;
  for (const child of container.children) {
    const rect = child.getBoundingClientRect();
    const distance = Math.max(rect.left - x, 0, x - rect.right) ** 2 + Math.max(rect.top - y, 0, y - rect.bottom) ** 2;
    if (distance < nearest) { target = child; nearest = distance; }
  }
  if (!target || target === node) {
    if (kind === 'pin') dragState.beforeId = pinPreview.beforeId;
    return;
  }
  const rect = target.getBoundingClientRect();
  const after = y > rect.bottom || (y >= rect.top && x > rect.left + rect.width / 2);
  const items = kind === 'pin' ? filtered.filter(pin => pin.id !== dragState.id) : openCollections();
  const targetId = kind === 'pin' ? target.dataset.pinId : target.dataset.collectionId;
  const index = items.findIndex(item => item.id === targetId);
  dragState.beforeId = after ? items[index + 1]?.id ?? null : targetId;
  if (kind === 'pin') {
    if (pinPreview.beforeId !== dragState.beforeId) {
      pinPreview = { id: dragState.id, beforeId: dragState.beforeId };
      scheduleLayout();
    }
    return;
  }
  if (dragState.beforeId === dragState.id) return;
  marker.hidden = false;
  Object.assign(marker.style, { left: `${Math.max(bounds.left, Math.min(bounds.right - 3, after ? rect.right - 2 : rect.left - 2))}px`, top: `${Math.max(rect.top, kind === 'pin' ? toolbarBottom : 0)}px`, height: `${Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, kind === 'pin' ? toolbarBottom : 0))}px` });
}

function scrollDrag() {
  if (!dragState) return;
  const { container, kind, x, y } = dragState, bounds = container.getBoundingClientRect();
  if (x >= bounds.left && x <= bounds.right && y >= 0 && y <= innerHeight) {
    if (kind === 'pin' && y >= $('toolbar').getBoundingClientRect().bottom) {
      const top = $('toolbar').getBoundingClientRect().bottom + 45;
      window.scrollBy(0, y < top ? -Math.min(18, (top - y) / 2) : Math.max(0, Math.min(18, (y - innerHeight + 60) / 2)));
    } else if (kind === 'collection' && y >= bounds.top && y <= bounds.bottom) {
      container.scrollLeft += x < bounds.left + 35 ? -12 : x > bounds.right - 35 ? 12 : 0;
    }
  }
  if (kind === 'pin') {
    const tabs = $('collections'), bounds = tabs.getBoundingClientRect();
    if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) tabs.scrollLeft += x < bounds.left + 35 ? -12 : x > bounds.right - 35 ? 12 : 0;
  }
  updateDrop();
  dragFrame = requestAnimationFrame(scrollDrag);
}

for (const [containerId, kind, selector] of [['grid', 'pin', '.pin'], ['collections', 'collection', '.collection-entry']]) {
  $(containerId).ondragstart = event => {
    const node = event.target.closest(selector);
    if (kind === 'pin' && $('grid').dataset.scope === 'all') { event.preventDefault(); return; }
    if (!node || reorderPending || document.querySelector('dialog[open]')) { event.preventDefault(); return; }
    const id = kind === 'pin' ? node.dataset.pinId : node.dataset.collectionId;
    dragState = { kind, id, node, container: $(containerId), x: event.clientX, y: event.clientY };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-papan-reorder', id);
    if (kind === 'pin') {
      pinPreview = { id, beforeId: filtered[filtered.findIndex(pin => pin.id === id) + 1]?.id ?? null };
      dragState.container.style.minHeight = `${dragState.container.getBoundingClientRect().height}px`;
      const rect = node.getBoundingClientRect(), outline = document.createElement('canvas');
      outline.width = Math.ceil(rect.width); outline.height = Math.ceil(rect.height);
      const context = outline.getContext('2d');
      context.strokeStyle = '#c1e6a4'; context.lineWidth = 2;
      context.strokeRect(1, 1, outline.width - 2, outline.height - 2);
      event.dataTransfer.setDragImage(outline, event.clientX - rect.left, event.clientY - rect.top);
    }
    dragFrame = requestAnimationFrame(() => {
      if (!dragState) return;
      node.classList.add('dragging');
      document.body.classList.add('is-dragging');
      scrollDrag();
    });
  };
}
document.addEventListener('dragover', event => {
  if (!dragState) return;
  dragState.x = event.clientX; dragState.y = event.clientY;
  updateDrop();
  if (dragState.beforeId !== undefined || dragState.targetCollectionId) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }
});
document.addEventListener('drop', async event => {
  if (!dragState) return;
  dragState.x = event.clientX; dragState.y = event.clientY;
  updateDrop();
  const { kind, id, beforeId, targetCollectionId } = dragState;
  endDrag(kind === 'pin' && beforeId !== undefined);
  if (targetCollectionId) {
    event.preventDefault();
    reorderPending = true;
    try {
      const pin = library.pins.find(item => item.id === id), target = library.collections.find(item => item.id === targetCollectionId);
      if (!pin || !target) throw new Error('The pin or collection no longer exists.');
      if (target.locked) throw new Error('Unlock the destination collection before moving a pin into it.');
      const input = { id, collectionId: target.id, title: pin.title, coverId: pin.coverId, tags: pin.tags || [], notes: pin.notes || '', requestId: crypto.randomUUID() };
      const background = target.settings.mode === 'offline' && !pin.offline;
      await (background ? api.enqueuePin(input) : api.updatePin(input));
      await refresh(background ? collectionId : target.id);
      toast(background ? 'moving after originals finish downloading' : `moved to ${target.name}`);
    } catch (error) { toastError(error); }
    finally { reorderPending = false; }
  } else if (beforeId !== undefined) { event.preventDefault(); reorderItem(kind, id, beforeId); }
});
document.addEventListener('dragend', () => endDrag());
document.addEventListener('dragleave', event => {
  if (dragState && (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight)) {
    dragState.x = -1; dragState.y = -1; updateDrop();
  }
});
document.addEventListener('keydown', event => {
  if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const tab = event.target.closest('.collection-tab'), pin = event.target.closest('.tile-main')?.closest('.pin');
  if (!tab && !pin || pin && $('grid').dataset.scope === 'all') return;
  event.preventDefault(); event.stopPropagation();
  const kind = tab ? 'collection' : 'pin', id = tab ? tab.dataset.collectionId : pin.dataset.pinId;
  const items = tab ? openCollections() : filtered, index = items.findIndex(item => item.id === id);
  if (event.key === 'ArrowLeft' && index > 0) reorderItem(kind, id, items[index - 1].id);
  if (event.key === 'ArrowRight' && index < items.length - 1) reorderItem(kind, id, items[index + 2]?.id ?? null);
}, true);

function switchCollection(id) {
  const target = openCollections().find(item => item.id === id);
  if (!target) return;
  if (target.locked) { openPassword('unlock', id); return; }
  if (id !== collectionId) {
    collectionId = id;
    resetFilters();
    render();
    window.scrollTo(0, 0);
  }
  $('collections').querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
}
function newCollectionTab() {
  if ($('new-collection').disabled || collectionFileBusy || reorderPending || dragState || document.querySelector('dialog[open]')) return;
  const tab = { id: `new-tab-${crypto.randomUUID()}`, name: 'new tab', temporary: true, settings: { ...defaults } };
  tabOrder = openCollections().map(item => item.id).concat(tab.id);
  temporaryTabs.push(tab);
  $('search-panel').hidePopover();
  switchCollection(tab.id);
}
$('collections').onclick = event => {
  const close = event.target.closest('[data-close-collection]');
  if (close) { closeCollection(close.dataset.closeCollection); return; }
  const tab = event.target.closest('[role="tab"]');
  if (tab) switchCollection(tab.dataset.collectionId);
};
$('collections').onkeydown = event => {
  if (!event.target.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const open = openCollections();
  const index = open.findIndex(item => item.id === (event.target.dataset.collectionId || collectionId));
  const count = open.length;
  if (!count) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
  switchCollection(open[next].id);
};
function resetFilters() { $('search').value = ''; $('search-scope').value = 'collection'; for (const id of ['search-kind', 'search-source', 'search-tag']) $(id).value = ''; }
$('reset-filters').onclick = () => { resetFilters(); render(); };
for (const id of ['search-scope', 'search-kind', 'search-source', 'search-tag']) $(id).onchange = render;
$('search').oninput = render;
$('search').onkeydown = event => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); $('search-panel').hidePopover(); $('toggle-search').focus(); }
};
$('search-panel').addEventListener('toggle', event => {
  $('toggle-search').setAttribute('aria-expanded', String(event.newState === 'open'));
  if (event.newState === 'open') { if (!collectionId) { $('search-scope').value = 'all'; render(); } $('search').focus(); }
});
$('clear-search').onclick = () => { resetFilters(); render(); $('search').focus(); };
$('start-collecting').onclick = () => openAdd();
$('add-link').onclick = () => openAdd();
$('new-collection').onclick = newCollectionTab;
$('collection-settings').onclick = () => openSettings();
$('link-form').onsubmit = event => { event.preventDefault(); findMedia(); };
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => button.dataset.close === 'settings-dialog' ? closeSettings() : $(button.dataset.close).close();
for (const dialog of document.querySelectorAll('dialog')) dialog.closedBy = 'any';
let dismissPopoverClick = false;
document.addEventListener('pointerdown', event => {
  document.documentElement.classList.remove('keyboard-navigation');
  dismissPopoverClick = false;
  const popover = document.querySelector('[popover]:popover-open');
  if (event.button !== 0 || !popover || popover.contains(event.target) || document.querySelector('dialog:modal')) return;
  dismissPopoverClick = true;
  popover.hidePopover();
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
document.addEventListener('click', event => {
  if (dismissPopoverClick && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); }
  dismissPopoverClick = false;
}, true);
$('add-dialog').addEventListener('close', () => {
  if (addRequest) api.cancel(addRequest).catch(() => {});
  addRequest = null;
  busyAdd(false);
});
$('settings-dialog').addEventListener('close', () => {
  if (settingsRequest) api.cancel(settingsRequest).catch(() => {});
  if (exportRequest) api.cancel(exportRequest).catch(() => {});
  layoutPreview = null;
  $('grid').dataset.fit = settings().fit;
  scheduleLayout();
});
$('viewer').addEventListener('close', () => { $('viewer-media').querySelector('video')?.pause(); $('viewer-media').replaceChildren(); $('viewer-details').replaceChildren(); });
document.addEventListener('paste', event => {
  if (document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
  const value = event.clipboardData.getData('text').trim();
  if (/^https?:\/\//i.test(value)) { event.preventDefault(); openAdd(value, true); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Tab') document.documentElement.classList.add('keyboard-navigation');
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && ['t', 'w'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    if (document.querySelector('dialog[open]') || dragState || event.repeat) return;
    if (event.key.toLowerCase() === 't') newCollectionTab();
    else {
      $('search-panel').hidePopover();
      const id = collectionId || document.activeElement.closest('.collection-entry')?.dataset.collectionId || openCollections()[0]?.id;
      if (id) closeCollection(id);
    }
    return;
  }
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Tab') {
    event.preventDefault();
    if (document.querySelector('dialog[open]') || dragState) return;
    const open = openCollections();
    if (open.length < 2) return;
    const index = open.findIndex(item => item.id === collectionId);
    $('search-panel').hidePopover();
    switchCollection(open[index < 0 ? (event.shiftKey ? open.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + open.length) % open.length].id);
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); openCollectionBrowser(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !document.querySelector('dialog[open]')) { event.preventDefault(); saveCollectionFile(event.shiftKey); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && library.collections.length && !document.querySelector('dialog[open]')) { event.preventDefault(); $('search-panel').showPopover(); $('search').focus(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!document.querySelector('dialog[open]')) openAdd(); }
  if ((event.metaKey || event.ctrlKey) && event.key === ',' && collectionId && !document.querySelector('dialog[open]')) { event.preventDefault(); openSettings(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !document.querySelector('dialog[open]') && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) { event.preventDefault(); restoreRemoval(); }
  if ($('viewer').open && !['INPUT', 'TEXTAREA', 'VIDEO'].includes(event.target.tagName)) {
    if (event.key === 'ArrowRight') $('viewer-next').click();
    if (event.key === 'ArrowLeft') $('viewer-prev').click();
  }
});
api.onProgress(({ id, message }) => {
  if (id === addRequest) $('add-status').textContent = message;
  if (id === settingsRequest) $('settings-status').textContent = message;
});

function clipTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const milliseconds = Math.round(Math.max(0, seconds) * 1000);
  return `${Math.floor(milliseconds / 60000)}:${((milliseconds % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
}

function seekClipFrame(video) {
  // Finish the current seek before decoding the latest handle position.
  if (video.readyState < 1 || video.seeking || !Number.isFinite(video._frameTime)) return;
  const time = Math.min(video._frameTime, Math.max(0, video.duration - .001));
  if (Math.abs(video.currentTime - time) > .0005) video.currentTime = time;
}
for (const id of ['clip-start-frame', 'clip-end-frame']) {
  $(id).addEventListener('loadedmetadata', () => seekClipFrame($(id)));
  $(id).addEventListener('seeked', () => seekClipFrame($(id)));
}

function closeClipEditor() {
  $('clip-editor').hidden = true;
  delete $('clip-range')._handle;
  for (const video of $('clip-editor').querySelectorAll('video')) { video.pause(); video.removeAttribute('src'); video.load(); }
  delete $('clip-player').dataset.playClip;
  for (const row of $('edit-covers').children) {
    row.classList.remove('editing');
    row.querySelector('[data-edit-clip]')?.setAttribute('aria-expanded', 'false');
  }
}

function updateClipEditor() {
  const row = $('edit-covers').querySelector('.editing');
  if (!row) return;
  const duration = row.querySelector('video').duration, known = Number.isFinite(duration) && duration > 0;
  const selected = row.querySelector('.preview-enabled').checked;
  const start = row._preview.start, end = row._preview.end ?? (known ? duration : null);
  $('clip-title').textContent = `${row.dataset.label} · preview range`;
  $('clip-duration').textContent = known ? `${clipTime(duration)} total` : '';
  $('clip-start-time').value = clipTime(start);
  $('clip-end-time').value = clipTime(end);
  for (const [input, value] of [[$('clip-start'), start], [$('clip-end'), end]]) {
    input.max = known ? duration : 1;
    input.value = value ?? 1;
    input.disabled = !selected || !known || $('save-pin-edit').disabled;
    input.setAttribute('aria-valuetext', `${Number((value || 0).toFixed(3))} seconds`);
  }
  const gap = Math.min(.01, known ? duration : .01);
  $('clip-start').setAttribute('aria-valuemax', Math.max(0, (end || 0) - gap));
  $('clip-end').setAttribute('aria-valuemin', Math.min(duration || 1, start + gap));
  $('clip-selected-range').style.left = `${known ? Math.min(100, start / duration * 100) : 0}%`;
  $('clip-selected-range').style.right = `${known ? Math.max(0, 100 - end / duration * 100) : 0}%`;
  $('play-clip').disabled = $('reset-clip').disabled = !selected || !known || $('save-pin-edit').disabled;
  $('clip-hint').textContent = row._mediaError ? 'This saved video is unavailable. Its existing range is kept.' : !selected ? 'Select this video above to include it in the board preview.' : !known ? 'Loading video frames…' : 'Drag either handle to choose the start and end. Arrow keys adjust by 0.1 seconds.';
  $('clip-start-frame')._frameTime = start;
  $('clip-end-frame')._frameTime = Math.max(0, (end || 0) - .001);
  seekClipFrame($('clip-start-frame')); seekClipFrame($('clip-end-frame'));
}

function updatePreviewInputs() {
  if ($('save-pin-edit').disabled) return;
  const rows = [...$('edit-covers').children];
  const chosen = rows.filter(row => row.querySelector('.preview-enabled').checked);
  if (!chosen.some(row => row.querySelector('[name="edit-cover"]').checked) && chosen.length) chosen[0].querySelector('[name="edit-cover"]').checked = true;
  for (const row of rows) {
    const enabled = row.querySelector('.preview-enabled'), video = row.querySelector('video');
    const invalidRange = video && Number.isFinite(video.duration) && (row._preview.start >= video.duration || row._preview.end !== null && row._preview.end > video.duration);
    enabled.setCustomValidity(!chosen.length ? 'Choose at least one saved item for the board preview.' : enabled.checked && invalidRange ? 'This clip extends beyond the saved video. Adjust its range or choose full video.' : '');
    row.classList.toggle('selected', enabled.checked);
    row.querySelector('[name="edit-cover"]').disabled = !enabled.checked;
    if (video) row.querySelector('.clip-summary').textContent = `${clipTime(row._preview.start)} – ${row._preview.end === null ? 'end' : clipTime(row._preview.end)}`;
  }
  if ($('edit-covers').querySelector('.editing .preview-enabled:not(:checked)')) { $('clip-player').pause(); delete $('clip-player').dataset.playClip; }
  updateClipEditor();
}

function selectClipVideo(row) {
  if (row.classList.contains('editing')) return;
  closeClipEditor();
  row.classList.add('editing');
  row.querySelector('[data-edit-clip]').setAttribute('aria-expanded', 'true');
  const source = row.querySelector('video').src;
  $('clip-editor').hidden = false;
  $('clip-player').hidden = true;
  for (const video of $('clip-editor').querySelectorAll('video')) video.src = source;
  updateClipEditor();
  $('clip-editor').scrollIntoView({ block: 'nearest' });
}

function setClipBoundary(input, value) {
  const row = $('edit-covers').querySelector('.editing');
  if (!row || input.disabled || !Number.isFinite(value)) return;
  const duration = row.querySelector('video').duration, gap = Math.min(.01, duration);
  let start = Math.min(row._preview.start, duration - gap), end = Math.min(row._preview.end ?? duration, duration);
  value = Math.round(value * 1000) / 1000;
  if (input.id === 'clip-start') start = Math.max(0, Math.min(value, end - gap));
  else end = Math.min(duration, Math.max(value, start + gap));
  row._preview = { start, end: end >= duration ? null : end };
  $('clip-player').pause(); $('clip-player').hidden = true; delete $('clip-player').dataset.playClip;
  updatePreviewInputs();
}
for (const id of ['clip-start', 'clip-end']) {
  $(id).oninput = () => setClipBoundary($(id), $(id).valueAsNumber);
  $(id).onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) return;
    event.preventDefault();
    const direction = ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key) ? -1 : 1;
    const value = event.key === 'Home' ? 0 : event.key === 'End' ? Number($(id).max) : $(id).valueAsNumber + direction * (event.shiftKey || event.key.startsWith('Page') ? 1 : .1);
    setClipBoundary($(id), value);
  };
}
$('clip-range').onpointerdown = event => {
  if (event.button !== 0 || event.target.tagName === 'INPUT' || $('clip-start').disabled) return;
  event.preventDefault();
  const bounds = $('clip-range').getBoundingClientRect(), value = (event.clientX - bounds.left - 9) / (bounds.width - 18) * Number($('clip-start').max);
  const input = Math.abs(value - $('clip-start').valueAsNumber) < Math.abs(value - $('clip-end').valueAsNumber) ? $('clip-start') : $('clip-end');
  $('clip-range')._handle = input;
  $('clip-range').setPointerCapture(event.pointerId);
  input.focus({ preventScroll: true });
  setClipBoundary(input, value);
};
$('clip-range').onpointermove = event => {
  const input = $('clip-range')._handle;
  if (!input) return;
  const bounds = $('clip-range').getBoundingClientRect();
  setClipBoundary(input, (event.clientX - bounds.left - 9) / (bounds.width - 18) * Number(input.max));
};
$('clip-range').onpointerup = $('clip-range').onpointercancel = event => {
  delete $('clip-range')._handle;
  if ($('clip-range').hasPointerCapture(event.pointerId)) $('clip-range').releasePointerCapture(event.pointerId);
};
$('play-clip').onclick = () => {
  const row = $('edit-covers').querySelector('.editing'), player = $('clip-player');
  if (!row) return;
  player.hidden = false;
  player.dataset.playClip = 'true';
  if (player.readyState >= 1) player.currentTime = row._preview.start;
  player.play().catch(error => { if (row.classList.contains('editing') && player.dataset.playClip) $('clip-hint').textContent = error.message; });
};
$('clip-player').addEventListener('loadedmetadata', () => {
  const row = $('edit-covers').querySelector('.editing');
  if (row && $('clip-player').dataset.playClip) $('clip-player').currentTime = row._preview.start;
});
$('clip-player').addEventListener('timeupdate', () => {
  const row = $('edit-covers').querySelector('.editing'), player = $('clip-player');
  if (row && player.dataset.playClip && player.currentTime >= (row._preview.end ?? player.duration)) { player.pause(); delete player.dataset.playClip; }
});
$('reset-clip').onclick = () => {
  const row = $('edit-covers').querySelector('.editing');
  if (!row) return;
  row._preview = { start: 0, end: null };
  $('clip-player').pause(); $('clip-player').hidden = true; delete $('clip-player').dataset.playClip;
  updatePreviewInputs();
};

function renderPinPreviews(reset = false) {
  closeClipEditor();
  for (const video of $('edit-covers').querySelectorAll('video')) { video.pause(); video.removeAttribute('src'); video.load(); }
  const visual = editingPin.items.filter(item => item.kind !== 'text');
  const previews = !reset && editingPin.previews || (visual.length ? visual : editingPin.items).map(item => ({ itemId: item.id }));
  $('edit-covers').innerHTML = editingPin.items.map((item, index) => {
    const source = escapeHTML(mediaURL(editingPin, item)), preview = previews.find(preview => preview.itemId === item.id), label = `${item.kind} ${index + 1}`;
    const visual = item.kind === 'video' ? `<button class="preview-visual preview-video" type="button" data-edit-clip aria-label="Edit video ${index + 1} preview" aria-controls="clip-editor" aria-expanded="false"><video src="${source}" preload="metadata" muted playsinline aria-hidden="true"></video><span>edit range</span></button><p class="clip-summary hint"></p>` : `<div class="preview-visual">${item.kind === 'text' ? `<div class="picker-text">${escapeHTML(item.text?.slice(0, 250))}</div>` : `<img src="${source}" alt="Saved image ${index + 1}" loading="lazy">`}</div>`;
    return `<div class="preview-item" data-item-id="${escapeHTML(item.id)}" data-label="${label}"><div class="preview-heading"><label><input class="preview-enabled" type="checkbox" aria-label="Show ${label} in preview" ${preview ? 'checked' : ''}>${label}</label><label><input type="radio" name="edit-cover" value="${escapeHTML(item.id)}" aria-label="Cover item ${index + 1}" ${editingPin.coverId === item.id ? 'checked' : ''}>cover</label></div>${visual}</div>`;
  }).join('');
  for (const row of $('edit-covers').querySelectorAll('.preview-item:has(video)')) {
    const preview = previews.find(preview => preview.itemId === row.dataset.itemId);
    row._preview = { start: preview?.start || 0, end: preview?.end ?? null };
    row.querySelector('video').addEventListener('loadedmetadata', () => { if (row.isConnected) updatePreviewInputs(); });
    row.querySelector('video').addEventListener('error', () => { row._mediaError = true; if (row.isConnected) updatePreviewInputs(); });
  }
  updatePreviewInputs();
}
$('edit-covers').onchange = event => {
  updatePreviewInputs();
  const row = event.target.closest('.preview-item');
  if (row?._preview && event.target.matches('.preview-enabled:checked')) selectClipVideo(row);
};
$('edit-covers').onclick = event => {
  const button = event.target.closest('[data-edit-clip]');
  if (button) selectClipVideo(button.closest('.preview-item'));
};
$('reset-previews').onclick = () => renderPinPreviews(true);

$('edit-pin').onclick = () => {
  editingPin = viewerPin;
  $('viewer').close();
  $('edit-title').value = editingPin.title;
  $('edit-tags').value = (editingPin.tags || []).join(', ');
  $('edit-notes').value = editingPin.notes || '';
  $('edit-collection').innerHTML = library.collections.filter(item => !item.locked).map(item => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}${item.closed ? ' (closed)' : ''}</option>`).join('') + '<option value="">+ new collection…</option>';
  $('edit-collection').value = editingPin.collectionId;
  renderPinPreviews();
  $('edit-error').textContent = '';
  $('edit-collection').onchange();
  $('pin-editor').showModal();
  $('edit-title').focus();
};
$('edit-collection').onchange = () => {
  const select = $('edit-collection');
  if (!select.value) { select.value = select.dataset.selected; openSettings(true); return; }
  select.dataset.selected = select.value;
  const target = library.collections.find(item => item.id === select.value);
  $('move-hint').textContent = target?.settings.mode === 'offline' && !editingPin?.offline ? 'Originals will download in the background before this move is saved.' : 'Existing media stays on this device. No files need to be copied.';
};
$('pin-edit-form').onsubmit = async event => {
  event.preventDefault();
  const input = { id: editingPin.id, requestId: crypto.randomUUID(), title: $('edit-title').value,
    tags: $('edit-tags').value.split(',').map(tag => tag.trim()).filter(Boolean), notes: $('edit-notes').value,
    collectionId: $('edit-collection').value, coverId: document.querySelector('[name="edit-cover"]:checked')?.value,
    previews: [...$('edit-covers').children].filter(row => row.querySelector('.preview-enabled').checked).map(row => ({ itemId: row.dataset.itemId,
      ...(row._preview || {}) })) };
  const background = library.collections.find(item => item.id === input.collectionId)?.settings.mode === 'offline' && !editingPin.offline;
  $('edit-error').textContent = '';
  for (const control of $('pin-edit-form').elements) control.disabled = true;
  try {
    await (background ? api.enqueuePin(input) : api.updatePin(input));
    $('pin-editor').close();
    await refresh(background ? collectionId : input.collectionId);
    toast(background ? 'moving after originals finish downloading' : 'pin saved');
  } catch (error) { errorAt('edit-error', error); }
  finally { for (const control of $('pin-edit-form').elements) control.disabled = false; updatePreviewInputs(); }
};
$('pin-editor').addEventListener('close', () => { closeClipEditor(); for (const video of $('edit-covers').querySelectorAll('video')) { video.pause(); video.removeAttribute('src'); video.load(); } $('edit-covers').replaceChildren(); });

async function restoreRemoval(id) {
  try {
    const restoredCollection = await api.undoRemove(id);
    if ($('collections-dialog').open) $('collections-dialog').close();
    resetFilters(); await refresh(restoredCollection); toast('restored to your collection');
  } catch (error) { toastError(error); }
}
$('undo-remove').onclick = () => restoreRemoval(undoId);
$('removed-items').onclick = event => { const button = event.target.closest('[data-restore]'); if (button) restoreRemoval(button.dataset.restore); };

$('export-collection').onclick = async () => {
  if (exportRequest || collectionFileBusy) return;
  exportRequest = crypto.randomUUID();
  $('export-collection').disabled = true;
  $('settings-error').textContent = '';
  $('settings-status').textContent = 'preparing portable copy…';
  try {
    const result = await api.exportCollection({ id: collectionId, requestId: exportRequest });
    if (result) toast(result.encrypted ? 'encrypted collection and media exported' : `portable copy exported · ${result.files} media files`);
  } catch (error) { if ($('settings-dialog').open) errorAt('settings-error', error); }
  finally { exportRequest = null; $('export-collection').disabled = false; $('settings-status').textContent = ''; }
};

function clearPrivateViews() {
  for (const id of ['viewer', 'pin-editor', 'add-dialog']) if ($(id).open) $(id).close();
  for (const id of ['viewer-title', 'viewer-source', 'viewer-details', 'viewer-media', 'edit-covers', 'media-picker', 'download-announcement', 'toast-message']) $(id).replaceChildren();
  for (const id of ['edit-title', 'edit-tags', 'edit-notes', 'pin-title', 'pin-tags', 'pin-notes', 'link-input']) $(id).value = '';
  viewerPin = editingPin = inspection = pinPreview = null;
  settingsOriginal = null; undoId = null;
  $('toast').hidden = true;
  resetFilters();
}
function openPassword(action, id = collectionId, replacementTab = null) {
  const current = library.collections.find(item => item.id === id);
  if (passwordBusy || $('password-dialog').open || !current) return;
  passwordAction = action; passwordCollection = id; passwordReplacementTab = replacementTab;
  const unlocking = action === 'unlock', removing = action === 'remove';
  $('password-title').textContent = unlocking ? `unlock ${current.name}` : removing ? 'remove password' : current.protected ? 'change password' : 'protect collection';
  $('password-description').textContent = unlocking ? 'Enter this collection’s password to view its pins and saved media.' : removing ? 'This creates unencrypted copies of the collection and its saved media. Enter the current password to continue.' : 'Encrypt pins, tags, notes, and saved media. The collection name stays visible. Copies in other collections, imported originals, and older exports stay as they are. Keep your password safe; Papan cannot recover it.';
  const needCurrent = !unlocking && current.protected;
  $('current-password-field').hidden = !needCurrent;
  $('current-password').required = needCurrent;
  $('new-password-fields').hidden = removing;
  $('confirm-password-field').hidden = unlocking;
  $('collection-password').required = !removing;
  $('collection-password').minLength = unlocking ? 1 : 8;
  $('collection-password').autocomplete = unlocking ? 'current-password' : 'new-password';
  $('password-label').textContent = unlocking ? 'password' : 'new password · at least 8 characters';
  $('confirm-password').required = !unlocking && !removing;
  $('submit-password').textContent = unlocking ? 'unlock' : removing ? 'remove password' : current.protected ? 'change password' : 'encrypt collection';
  $('password-error').textContent = $('password-status').textContent = '';
  $('password-form').reset();
  $('password-dialog').showModal();
  $(needCurrent ? 'current-password' : 'collection-password').focus();
}
for (const [id, action] of [['manage-protection', 'set'], ['remove-protection', 'remove']]) $(id).onclick = async () => {
  if (settingsRequest || passwordBusy) return;
  await $('settings-form').onsubmit({ preventDefault() {} });
  if (!$('settings-dialog').open) openPassword(action);
};
$('lock-collection').onclick = async () => {
  try {
    const id = collectionId;
    await api.lockCollection({ id });
    clearPrivateViews(); await refresh();
    renderDownloads(await api.downloads(), true);
    toast('collection locked');
  } catch (error) { toastError(error); }
};
$('password-form').onsubmit = async event => {
  event.preventDefault();
  if (passwordBusy) return;
  const action = passwordAction, id = passwordCollection, replacementTab = passwordReplacementTab, password = $('collection-password').value;
  if (action === 'set' && password !== $('confirm-password').value) { $('password-error').textContent = 'The passwords do not match.'; return; }
  const currentPassword = $('current-password').value;
  passwordBusy = true;
  $('password-error').textContent = '';
  $('password-status').textContent = action === 'unlock' ? 'unlocking…' : action === 'remove' ? 'restoring unencrypted media…' : 'encrypting collection and saved media…';
  for (const control of $('password-form').elements) control.disabled = true;
  try {
    await (action === 'unlock' ? api.unlockCollection({ id, password }) : api.protectCollection({ id, password: action === 'remove' ? null : password, currentPassword }));
    const dismissed = !$('password-dialog').open;
    if (action === 'unlock' && dismissed) await api.lockCollection({ id });
    if (action === 'unlock' && !dismissed) {
      if (temporaryTabs.some(item => item.id === replacementTab)) {
        temporaryTabs = temporaryTabs.filter(item => item.id !== replacementTab);
        tabOrder = tabOrder.filter(item => item !== id).map(item => item === replacementTab ? id : item);
      }
      resetFilters();
    }
    $('password-dialog').close();
    await refresh(dismissed ? undefined : id); renderDownloads(await api.downloads(), true);
    if (!dismissed) {
      if (action === 'unlock') { window.scrollTo(0, 0); $('collections').querySelector('[aria-selected="true"]')?.focus({ preventScroll: true }); }
      toast(library.protectionWarning || (action === 'unlock' ? 'collection unlocked' : action === 'remove' ? 'password removed' : 'collection encrypted'));
    }
  } catch (error) { if ($('password-dialog').open) errorAt('password-error', error); else toastError(error); }
  finally {
    passwordBusy = false;
    for (const control of $('password-form').elements) control.disabled = false;
    $('password-status').textContent = '';
  }
};
$('password-dialog').addEventListener('close', () => {
  if ($('password-dialog').open) return;
  $('password-form').reset(); $('password-error').textContent = ''; passwordAction = passwordCollection = passwordReplacementTab = null;
});

function renderDownloads(tasks, initial = false) {
  const pending = tasks.filter(task => ['queued', 'running'].includes(task.state)).length;
  const unfinished = tasks.filter(task => task.state !== 'completed');
  $('downloads-toggle').hidden = !pending;
  $('download-count').textContent = pending || '';
  $('review-downloads').hidden = !unfinished.length;
  if (!unfinished.length) $('downloads-panel').hidePopover();
  $('download-list').innerHTML = unfinished.length ? [...unfinished].reverse().map(task => `<article class="download" data-state="${escapeHTML(task.state)}" role="listitem">
    <h2>${escapeHTML(task.title)}</h2><p>${escapeHTML(task.error || (task.state === 'queued' ? 'queued · waiting for the previous task' : task.progress || task.state))}</p>
    ${task.state === 'running' ? '<progress aria-label="Saving media"></progress>' : ''}
    <div class="download-actions">${['queued', 'running'].includes(task.state) ? `<button class="text-button" data-task="${task.id}" data-action="cancelDownload">cancel</button>` : `${task.state !== 'completed' ? `<button class="text-button" data-task="${task.id}" data-action="retryDownload">retry</button>` : ''}<button class="text-button" data-task="${task.id}" data-action="dismissDownload">dismiss</button>`}</div></article>`).join('') : '<p class="hint">no downloads</p>';
  for (const task of tasks) {
    if (!initial && downloadStates.get(task.id) !== task.state && ['completed', 'failed', 'cancelled'].includes(task.state)) {
      const message = task.state === 'completed' ? `saved · ${task.title}` : `${task.state} · ${task.title}`;
      $('download-announcement').textContent = message;
      toast(message);
      if (task.state === 'completed') refresh().catch(toastError);
    }
  }
  downloadStates = new Map(unfinished.map(task => [task.id, task.state]));
}
$('review-downloads').onclick = () => { $('collections-dialog').close(); $('downloads-panel').showPopover(); };
$('download-list').onclick = async event => {
  const button = event.target.closest('[data-task]');
  if (!button || !['cancelDownload', 'retryDownload', 'dismissDownload'].includes(button.dataset.action)) return;
  button.disabled = true;
  try { await api[button.dataset.action](button.dataset.task); }
  catch (error) { toastError(error); }
  finally { if (button.isConnected) button.disabled = false; }
};
api.onDownloads(tasks => renderDownloads(tasks));
api.downloads().then(tasks => renderDownloads(tasks, true)).catch(toastError);
refresh().then(() => { if (!collectionId && openCollections().length) switchCollection(openCollections()[0].id); }).catch(toastError);
