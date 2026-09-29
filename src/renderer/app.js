const $ = id => document.getElementById(id);
const api = window.papan;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const mediaURL = (pin, item, original = false) => item.previewFile || item.previewPath || item.localFile || item.localPath
  ? `papan://media/${pin.id}/${item.id}/${original ? 'original' : 'preview'}?v=${encodeURIComponent(pin.folder || '')}` : item.url;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let library = { collections: [], pins: [] }, collectionId = null, inspection = null;
let selected = new Set(), coverId = null, addRequest = null, settingsRequest = null;
let creatingCollection = false, shown = 0, filtered = [], viewerPin = null, viewerIndex = 0;
let toastTimer, confirmAction, layoutFrame = 0, gridWidth = 0;
let dragState = null, dragFrame = 0, reorderPending = false;
let pinPreview = null;
let layoutPreview = null;
let collectionFileBusy = false;
const visible = new Set();
const defaults = { mode: 'online', density: 3, fit: 'contain', motion: true, slideshowSeconds: 4 };
const collection = () => library.collections.find(item => item.id === collectionId);
const openCollections = () => library.collections.filter(item => !item.closed);
const settings = () => layoutPreview || collection()?.settings || defaults;
const motion = () => settings().motion && !reducedMotion.matches && !document.hidden && !document.querySelector('dialog[open]:not(#settings-dialog)') && !($('settings-dialog').open && creatingCollection);

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

function errorAt(id, error) { $(id).textContent = error.message || String(error); }

async function refresh(preferred) {
  library = await api.library();
  collectionId = [preferred, collectionId, openCollections()[0]?.id].find(id => openCollections().some(item => item.id === id)) || null;
  render();
}

function render() {
  $('toolbar').hidden = !library.collections.length;
  document.body.classList.toggle('has-collections', Boolean(library.collections.length));
  $('collections').innerHTML = openCollections().map(item => `<div class="collection-entry" role="presentation" data-collection-id="${escapeHTML(item.id)}"><button type="button" class="collection-tab" role="tab" draggable="true" aria-describedby="reorder-help" id="collection-tab-${escapeHTML(item.id)}" data-collection-id="${escapeHTML(item.id)}" aria-selected="${item.id === collectionId}" aria-controls="canvas" tabindex="${item.id === collectionId ? 0 : -1}" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</button><button type="button" class="collection-close" data-close-collection="${escapeHTML(item.id)}" aria-label="Close ${escapeHTML(item.name)}" title="Close collection" tabindex="${item.id === collectionId ? 0 : -1}">×</button></div>`).join('');
  if (collectionId) {
    $('canvas').setAttribute('role', 'tabpanel');
    $('canvas').setAttribute('aria-labelledby', `collection-tab-${collectionId}`);
    $('canvas').tabIndex = 0;
    $('collections').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } else {
    for (const name of ['role', 'aria-labelledby', 'tabindex']) $('canvas').removeAttribute(name);
  }
  $('storage-mode').textContent = collectionId ? settings().mode : '';
  for (const id of ['toggle-search', 'collection-settings', 'save-collection-file']) $(id).disabled = !collectionId || collectionFileBusy;
  $('open-empty-collection').hidden = Boolean(collectionId);
  $('grid').dataset.fit = settings().fit;
  const query = $('search').value.trim().toLowerCase();
  $('toggle-search').classList.toggle('has-filter', Boolean(query));
  filtered = library.pins.filter(pin => pin.collectionId === collectionId && (!query || `${pin.title} ${pin.author} ${pin.text} ${pin.sourceUrl}`.toLowerCase().includes(query)));
  $('empty').hidden = filtered.length > 0;
  $('start-collecting').textContent = query ? 'nothing here matches that search' : 'paste link to start collecting';
  $('start-collecting').disabled = Boolean(query);
  $('grid').hidden = !filtered.length;
  for (const card of $('grid').children) { pause(card); card._cancelSizing?.(); }
  visible.clear();
  observer.disconnect();
  $('grid').replaceChildren();
  shown = 0;
  appendPins();
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
    card.draggable = true;
    card.setAttribute('role', 'listitem');
    card.dataset.pinId = pin.id;
    card._pin = pin;
    const visual = pin.items.filter(item => item.kind !== 'text');
    card.classList.toggle('album', visual.length > 1);
    card._slides = visual.length ? visual : pin.items;
    card._index = Math.max(0, card._slides.findIndex(item => item.id === pin.coverId));
    card._ratio = albumRatio(card._slides);
    card._sized = card._slides.length < 2 || card._slides.every(item => item.kind === 'text' || itemRatio(item));
    card._last = Date.now();
    const domain = new URL(pin.sourceUrl).hostname.replace(/^www\./, '');
    card.innerHTML = `<button class="tile-main" aria-label="${escapeHTML(pin.title)}"><div class="tile-media"></div><span class="tile-overlay"><span class="tile-title">${escapeHTML(pin.title)}</span><span class="tile-source">${escapeHTML(domain)}</span></span></button><button class="pin-detail" aria-label="Details for ${escapeHTML(pin.title)}" title="View saved items">···</button>${card._slides.length > 1 ? `<span class="album-mark" aria-label="${card._slides.length} slides"><span class="slide-dot active"></span>${'<span class="slide-dot"></span>'.repeat(Math.min(card._slides.length - 1, 5))}<span class="album-count">${card._slides.length}</span></span>` : ''}`;
    card.querySelector('.tile-main').onclick = () => {
      if (settings().mode === 'online') api.openSource(pin.id).catch(toastError);
      else openViewer(pin);
    };
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

function showSlide(card) {
  const item = card._slides[card._index];
  const target = card.querySelector('.tile-media');
  const source = mediaURL(card._pin, item);
  pause(card);
  if (item.kind === 'text') {
    target.innerHTML = `<div class="text-tile"><span class="text-mark">Aa</span><h2>${escapeHTML(card._pin.title)}</h2><p>${escapeHTML(item.text)}</p></div>`;
  } else if (item.kind === 'video') {
    const video = document.createElement('video');
    video.src = source || '';
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = Boolean(motion());
    video.loop = card._slides.length === 1;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-label', card._pin.title);
    video.addEventListener('loadedmetadata', () => rememberDimensions(card, item, video.videoWidth, video.videoHeight));
    target.replaceChildren(video);
    video.addEventListener('error', () => mediaError(target, 'video preview unavailable'));
    if (motion()) video.play().catch(() => {});
  } else {
    const img = document.createElement('img');
    img.draggable = false;
    img.src = source || '';
    img.alt = item.alt || card._pin.title;
    img.decoding = 'async';
    img.addEventListener('load', () => rememberDimensions(card, item, img.naturalWidth, img.naturalHeight));
    img.addEventListener('error', () => mediaError(target, 'image unavailable'));
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
      if (!card._loaded && !card._sizing) {
        if (card._sized) showSlide(card); else prepareAlbum(card);
      }
      if (motion()) card.querySelector('video')?.play().catch(() => {});
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
window.addEventListener('resize', scheduleLayout);

setInterval(() => {
  if (!motion()) { for (const card of visible) pause(card); return; }
  const now = Date.now();
  for (const card of visible) {
    if (card._sizing) continue;
    const video = card.querySelector('video');
    if (card._slides.length > 1 && (video ? video.ended : now - card._last >= settings().slideshowSeconds * 1000)) {
      card._index = (card._index + 1) % card._slides.length;
      showSlide(card);
    } else video?.play().catch(() => {});
  }
}, 400);

function toastError(error) { toast(error.message || String(error)); }

function openAdd(link = '', inspect = false) {
  if ($('add-dialog').open) return;
  inspection = null;
  selected.clear();
  $('inspection').hidden = true;
  $('link-input').value = link;
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
    $('save-collection-row').hidden = !openCollections().length;
    $('save-collection').innerHTML = openCollections().map(item => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join('');
    $('save-collection').value = collectionId || '';
    $('save-hint').textContent = openCollections().length ? 'only selected items will be saved' : 'a new collection will be created';
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
    const result = await api.save({ requestId, inspectionId: inspection.id, selectedIds: [...selected], coverId,
      collectionId: $('save-collection').value || null, title: $('pin-title').value });
    addRequest = null;
    $('add-dialog').close();
    await refresh(result.collectionId);
    toast('added to your collection');
  } catch (error) { if ($('add-dialog').open) errorAt('add-error', error); }
  finally { if (addRequest === requestId) addRequest = null; busyAdd(false); $('add-status').textContent = ''; }
};

$('layout-density').oninput = () => {
  $('density-value').value = $('layout-density').value;
  $('layout-density').setAttribute('aria-valuetext', `${$('layout-density').value} of 10`);
};
$('slide-seconds').oninput = () => {
  $('slideshow-value').value = `${$('slide-seconds').value} s`;
  $('slide-seconds').setAttribute('aria-valuetext', `${$('slide-seconds').value} ${$('slide-seconds').value === '1' ? 'second' : 'seconds'}`);
};
$('settings-form').addEventListener('input', event => {
  if (creatingCollection || !$('settings-dialog').open || !['layout-density', 'media-fit', 'slide-seconds', 'motion'].includes(event.target.id)) return;
  layoutPreview = { ...collection().settings, density: Number($('layout-density').value), fit: $('media-fit').value,
    slideshowSeconds: Number($('slide-seconds').value), motion: $('motion').checked };
  $('grid').dataset.fit = settings().fit;
  scheduleLayout();
  for (const card of visible) {
    const video = card.querySelector('video');
    if (motion()) video?.play().catch(() => {}); else video?.pause();
    if (['slide-seconds', 'motion'].includes(event.target.id)) card._last = Date.now();
  }
});

function openSettings(create = false) {
  creatingCollection = create;
  layoutPreview = null;
  const current = create ? { name: '', settings: defaults } : collection();
  if (!current) return;
  $('settings-title').textContent = create ? 'a new collection' : 'collection settings';
  $('collection-name').value = current.name;
  $('collection-name').placeholder = 'name this corner of the internet';
  $('collection-mode').value = current.settings.mode;
  $('layout-density').value = current.settings.density;
  $('media-fit').value = current.settings.fit;
  $('slide-seconds').value = current.settings.slideshowSeconds;
  $('layout-density').oninput();
  $('slide-seconds').oninput();
  $('motion').checked = current.settings.motion;
  $('delete-collection').hidden = create;
  $('tools-info').hidden = create;
  $('collection-storage').hidden = create;
  $('collection-destination').textContent = current.destination || 'saved in Papan · no external destination yet';
  $('choose-destination').textContent = current.destination ? 'save as…' : 'choose destination…';
  $('library-folder').textContent = current.destination ? 'open destination folder ↗' : 'open local library folder ↗';
  $('save-settings').textContent = create ? 'create collection' : 'save settings';
  $('settings-error').textContent = '';
  $('settings-status').textContent = '';
  $('settings-dialog').classList.toggle('preview-settings', !create);
  $('layout-preview-hint').hidden = create;
  $('settings-dialog').showModal();
  if (create) $('collection-name').focus();
  else api.tools().then(versions => { $('tool-versions').textContent = `gallery-dl ${versions['gallery-dl']} · yt-dlp ${versions['yt-dlp']} · Instaloader ${versions.Instaloader}`; }).catch(error => { $('tool-versions').textContent = error.message; });
}

$('settings-form').onsubmit = async event => {
  event.preventDefault();
  if (settingsRequest) return;
  const requestId = crypto.randomUUID();
  settingsRequest = requestId;
  const input = { id: collectionId, requestId, name: $('collection-name').value, settings: {
    mode: $('collection-mode').value, density: Number($('layout-density').value), fit: $('media-fit').value,
    motion: $('motion').checked, slideshowSeconds: Number($('slide-seconds').value),
  } };
  $('settings-error').textContent = '';
  $('settings-status').textContent = 'saving collection…';
  for (const control of $('settings-form').elements) control.disabled = true;
  try {
    const result = await (creatingCollection ? api.createCollection(input) : api.updateCollection(input));
    settingsRequest = null;
    $('settings-dialog').close();
    $('search').value = '';
    await refresh(result.id);
  } catch (error) { if ($('settings-dialog').open) errorAt('settings-error', error); }
  finally {
    settingsRequest = null;
    for (const control of $('settings-form').elements) control.disabled = false;
    $('settings-status').textContent = '';
  }
};

function openViewer(pin) {
  viewerPin = pin;
  viewerIndex = Math.max(0, pin.items.findIndex(item => item.id === pin.coverId));
  $('viewer-title').textContent = pin.title;
  $('viewer-source').textContent = `${pin.author ? `${pin.author} · ` : ''}${new URL(pin.sourceUrl).hostname} · ${pin.offline ? 'saved offline' : 'cached preview'}`;
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
  await api.deletePin(viewerPin.id); $('viewer').close(); await refresh();
});
$('delete-collection').onclick = () => confirmRemove(`Remove “${collection().name}” and all of its pins?`, async () => {
  await api.deleteCollection(collectionId); $('settings-dialog').close(); await refresh();
});
$('viewer-prev').onclick = () => { viewerIndex = (viewerIndex + viewerPin.items.length - 1) % viewerPin.items.length; renderViewer(); };
$('viewer-next').onclick = () => { viewerIndex = (viewerIndex + 1) % viewerPin.items.length; renderViewer(); };
$('open-source').onclick = () => api.openSource(viewerPin.id).catch(toastError);
$('library-folder').onclick = () => api.openFolder(collectionId).catch(toastError);

async function saveCollectionFile(chooseDestination = false) {
  if (!collectionId || collectionFileBusy) return;
  const id = collectionId;
  collectionFileBusy = true;
  $('save-collection-file').disabled = $('choose-destination').disabled = true;
  try {
    const saved = await api.saveCollection({ id, chooseDestination });
    if (!saved) return;
    await refresh(saved.id);
    $('collection-destination').textContent = saved.destination;
    $('choose-destination').textContent = 'save as…';
    toast('Collection list saved · media stays in its current location');
  } catch (error) { toastError(error); }
  finally {
    collectionFileBusy = false;
    for (const id of ['toggle-search', 'collection-settings', 'save-collection-file']) $(id).disabled = !collectionId;
    $('choose-destination').disabled = false;
  }
}

async function closeCollection(id) {
  if (collectionFileBusy || reorderPending) return;
  try {
    const open = openCollections(), index = open.findIndex(item => item.id === id);
    const next = id === collectionId ? (open[index + 1] || open[index - 1])?.id : collectionId;
    await api.closeCollection(id);
    if (id === collectionId) $('search').value = '';
    await refresh(next);
    toast('Collection closed · reopen it from Open collection');
  } catch (error) { toastError(error); }
}

function openCollectionBrowser() {
  if (document.querySelector('dialog[open]') || collectionFileBusy) return;
  const closed = library.collections.filter(item => item.closed);
  $('closed-collections').innerHTML = (closed.length ? '<span class="storage-heading">closed collections</span>' : '<p class="hint">no closed collections yet</p>') + closed.map(item => `<button class="closed-collection" data-reopen-collection="${escapeHTML(item.id)}"><span>${escapeHTML(item.name)}</span><small>${library.pins.filter(pin => pin.collectionId === item.id).length} pins · ${escapeHTML(item.destination || 'saved in Papan')}</small></button>`).join('');
  $('collection-file-status').textContent = '';
  $('collection-file-error').textContent = '';
  $('collections-dialog').showModal();
}

async function openCollectionFile(id) {
  if (collectionFileBusy) return;
  collectionFileBusy = true;
  $('collection-file-error').textContent = '';
  $('collection-file-status').textContent = id ? 'reopening collection…' : 'opening collection…';
  for (const button of $('collections-dialog').querySelectorAll('button:not([data-close])')) button.disabled = true;
  try {
    const opened = await (id ? api.reopenCollection(id) : api.openCollection());
    if (!opened) return;
    $('collections-dialog').close();
    $('search').value = '';
    await refresh(opened.id);
    if (opened.warning) toast(opened.warning);
  } catch (error) { errorAt('collection-file-error', error); }
  finally {
    collectionFileBusy = false;
    $('collection-file-status').textContent = '';
    for (const button of $('collections-dialog').querySelectorAll('button:not([data-close])')) button.disabled = false;
    for (const id of ['toggle-search', 'collection-settings', 'save-collection-file']) $(id).disabled = !collectionId;
  }
}

$('open-collection').onclick = $('open-empty-collection').onclick = openCollectionBrowser;
$('save-collection-file').onclick = () => saveCollectionFile();
$('choose-destination').onclick = () => saveCollectionFile(true);
$('browse-collection').onclick = () => openCollectionFile();
$('closed-collections').onclick = event => { const button = event.target.closest('[data-reopen-collection]'); if (button) openCollectionFile(button.dataset.reopenCollection); };

async function reorderItem(kind, id, beforeId) {
  if (reorderPending || id === beforeId) return;
  reorderPending = true;
  try {
    library = await api.reorder({ kind, id, beforeId });
    const container = $(kind === 'pin' ? 'grid' : 'collections');
    const focused = document.activeElement, scroll = container.scrollLeft;
    const nodes = new Map([...container.children].map(node => [kind === 'pin' ? node.dataset.pinId : node.dataset.collectionId, node]));
    const items = kind === 'pin' ? library.pins : library.collections;
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
    toast('Order saved');
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
  dragState = null;
}

function updateDrop() {
  const marker = $('drop-marker');
  marker.hidden = true;
  if (!dragState) return;
  const { container, kind, x, y, node } = dragState;
  dragState.beforeId = undefined;
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
  updateDrop();
  dragFrame = requestAnimationFrame(scrollDrag);
}

for (const [containerId, kind, selector] of [['grid', 'pin', '.pin'], ['collections', 'collection', '.collection-entry']]) {
  $(containerId).ondragstart = event => {
    const node = event.target.closest(selector);
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
  if (dragState.beforeId !== undefined) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }
});
document.addEventListener('drop', event => {
  if (!dragState) return;
  const { kind, id, beforeId } = dragState;
  endDrag(kind === 'pin' && beforeId !== undefined);
  if (beforeId !== undefined) { event.preventDefault(); reorderItem(kind, id, beforeId); }
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
  if (!tab && !pin) return;
  event.preventDefault(); event.stopPropagation();
  const kind = tab ? 'collection' : 'pin', id = tab ? tab.dataset.collectionId : pin.dataset.pinId;
  const items = tab ? openCollections() : filtered, index = items.findIndex(item => item.id === id);
  if (event.key === 'ArrowLeft' && index > 0) reorderItem(kind, id, items[index - 1].id);
  if (event.key === 'ArrowRight' && index < items.length - 1) reorderItem(kind, id, items[index + 2]?.id ?? null);
}, true);

function switchCollection(id) {
  if (id !== collectionId) {
    collectionId = id;
    $('search').value = '';
    render();
    window.scrollTo(0, 0);
  }
  $('collections').querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
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
$('search').oninput = render;
$('search').onkeydown = event => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); $('search-panel').hidePopover(); $('toggle-search').focus(); }
};
$('search-panel').addEventListener('toggle', event => {
  $('toggle-search').setAttribute('aria-expanded', String(event.newState === 'open'));
  if (event.newState === 'open') $('search').focus();
});
$('clear-search').onclick = () => { $('search').value = ''; render(); $('search').focus(); };
$('start-collecting').onclick = () => openAdd();
$('add-link').onclick = () => openAdd();
$('new-collection').onclick = () => openSettings(true);
$('collection-settings').onclick = () => openSettings();
$('link-form').onsubmit = event => { event.preventDefault(); findMedia(); };
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(button.dataset.close).close();
$('add-dialog').addEventListener('close', () => {
  if (addRequest) api.cancel(addRequest).catch(() => {});
  addRequest = null;
  busyAdd(false);
});
$('settings-dialog').addEventListener('close', () => {
  if (settingsRequest) api.cancel(settingsRequest).catch(() => {});
  layoutPreview = null;
  $('grid').dataset.fit = settings().fit;
  scheduleLayout();
});
$('viewer').addEventListener('close', () => { $('viewer-media').querySelector('video')?.pause(); $('viewer-media').replaceChildren(); });
document.addEventListener('paste', event => {
  if (document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
  const value = event.clipboardData.getData('text').trim();
  if (/^https?:\/\//i.test(value)) { event.preventDefault(); openAdd(value, true); }
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); openCollectionBrowser(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !document.querySelector('dialog[open]')) { event.preventDefault(); saveCollectionFile(event.shiftKey); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && collectionId && !document.querySelector('dialog[open]')) { event.preventDefault(); $('search-panel').showPopover(); $('search').focus(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!document.querySelector('dialog[open]')) openAdd(); }
  if ((event.metaKey || event.ctrlKey) && event.key === ',' && collectionId && !document.querySelector('dialog[open]')) { event.preventDefault(); openSettings(); }
  if ($('viewer').open && !['INPUT', 'TEXTAREA', 'VIDEO'].includes(event.target.tagName)) {
    if (event.key === 'ArrowRight') $('viewer-next').click();
    if (event.key === 'ArrowLeft') $('viewer-prev').click();
  }
});
api.onProgress(({ id, message }) => {
  if (id === addRequest) $('add-status').textContent = message;
  if (id === settingsRequest) $('settings-status').textContent = message;
});
refresh().catch(toastError);
