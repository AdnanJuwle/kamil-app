const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kamilApp', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  platform: process.platform,
})