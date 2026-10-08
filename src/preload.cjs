const { contextBridge, ipcRenderer } = require('electron');

const invoke = channel => async input => {
  const result = await ipcRenderer.invoke(`papan:${channel}`, input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

contextBridge.exposeInMainWorld('papan', {
  browserSession: invoke('browser-session'), setBrowserSession: invoke('set-browser-session'),
  phoneReceiver: invoke('phone-receiver'), configurePhone: invoke('configure-phone'), pairPhone: invoke('pair-phone'),
  revokePhone: invoke('revoke-phone'), retryPhoneShare: invoke('retry-phone-share'), dismissPhoneShare: invoke('dismiss-phone-share'), clearPhoneReceipts: invoke('clear-phone-receipts'),
  unlockCollection: invoke('unlock-collection'), lockCollection: invoke('lock-collection'), protectCollection: invoke('protect-collection'),
  library: invoke('library'), inspect: invoke('inspect'), save: invoke('save'), cancel: invoke('cancel'),
  enqueueSave: invoke('enqueue-save'), downloads: invoke('downloads'), cancelDownload: invoke('cancel-download'),
  retryDownload: invoke('retry-download'), dismissDownload: invoke('dismiss-download'),
  enqueuePose: invoke('enqueue-pose'), poseSetup: invoke('pose-setup'), openPoseGuide: invoke('pose-guide'),
  updatePin: invoke('update-pin'), enqueuePin: invoke('enqueue-pin'), repairPreviews: invoke('repair-previews'), undoRemove: invoke('undo-remove'),
  enqueueCollection: invoke('enqueue-collection'), exportCollection: invoke('export-collection'),
  createCollection: invoke('create-collection'), updateCollection: invoke('update-collection'), setPreviewSize: invoke('set-preview-size'), copyLink: invoke('copy-link'),
  saveCollection: invoke('save-collection'), openCollection: invoke('open-collection'),
  closeCollection: invoke('close-collection'), reopenCollection: invoke('reopen-collection'),
  clearCollectionHistory: invoke('clear-collection-history'),
  deleteCollection: invoke('delete-collection'), deletePin: invoke('delete-pin'), reorder: invoke('reorder'),
  openSource: invoke('open-source'), openFolder: invoke('open-folder'), tools: invoke('tools'),
  onWindowVisibility: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('papan:window-visibility', listener);
    return () => ipcRenderer.removeListener('papan:window-visibility', listener);
  },
  onProgress: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('papan:progress', listener);
    return () => ipcRenderer.removeListener('papan:progress', listener);
  },
  onDownloads: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('papan:downloads', listener);
    return () => ipcRenderer.removeListener('papan:downloads', listener);
  },
  onPhoneInbox: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('papan:phone-inbox', listener);
    return () => ipcRenderer.removeListener('papan:phone-inbox', listener);
  },
});
