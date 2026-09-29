const { contextBridge, ipcRenderer } = require('electron');

const invoke = channel => async input => {
  const result = await ipcRenderer.invoke(`papan:${channel}`, input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

contextBridge.exposeInMainWorld('papan', {
  library: invoke('library'), inspect: invoke('inspect'), save: invoke('save'), cancel: invoke('cancel'),
  enqueueSave: invoke('enqueue-save'), downloads: invoke('downloads'), cancelDownload: invoke('cancel-download'),
  retryDownload: invoke('retry-download'), dismissDownload: invoke('dismiss-download'),
  updatePin: invoke('update-pin'), enqueuePin: invoke('enqueue-pin'), undoRemove: invoke('undo-remove'),
  enqueueCollection: invoke('enqueue-collection'), exportCollection: invoke('export-collection'),
  createCollection: invoke('create-collection'), updateCollection: invoke('update-collection'),
  saveCollection: invoke('save-collection'), openCollection: invoke('open-collection'),
  closeCollection: invoke('close-collection'), reopenCollection: invoke('reopen-collection'),
  deleteCollection: invoke('delete-collection'), deletePin: invoke('delete-pin'), reorder: invoke('reorder'),
  openSource: invoke('open-source'), openFolder: invoke('open-folder'), tools: invoke('tools'),
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
});
