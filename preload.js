const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fel7o', {
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),

  // history
  getHistory: () => ipcRenderer.invoke('history:get'),
  addHistory: (entry) => ipcRenderer.invoke('history:add', entry),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  deleteHistory: (id) => ipcRenderer.invoke('history:delete', id),

  // fs / shell
  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  openJobFolder: (payload) => ipcRenderer.invoke('shell:openJobFolder', payload),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // tools
  checkFfmpeg: () => ipcRenderer.invoke('tools:checkFfmpeg'),
  checkYtdlp: () => ipcRenderer.invoke('tools:checkYtdlp'),

  // downloads
  startDownload: (job) => ipcRenderer.invoke('download:start', job),
  pauseDownload: (jobId) => ipcRenderer.invoke('download:pause', jobId),
  resumeDownload: (jobId) => ipcRenderer.invoke('download:resume', jobId),
  pauseAll: () => ipcRenderer.invoke('download:pauseAll'),
  resumeAll: () => ipcRenderer.invoke('download:resumeAll'),
  cancelDownload: (jobId) => ipcRenderer.invoke('download:cancel', jobId),
  notify: (opts) => ipcRenderer.invoke('notify', opts),
  getVideoInfo: (url) => ipcRenderer.invoke('ytdlp:getInfo', url),
  getPlaylistInfo: (url) => ipcRenderer.invoke('ytdlp:getPlaylistInfo', url),
  onProgress: (cb) => ipcRenderer.on('download:progress', (_e, data) => cb(data)),
  onDone: (cb) => ipcRenderer.on('download:done', (_e, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('download:error', (_e, data) => cb(data)),
  onCancelled: (cb) => ipcRenderer.on('download:cancelled', (_e, data) => cb(data)),
  onLog: (cb) => ipcRenderer.on('download:log', (_e, data) => cb(data)),
});
