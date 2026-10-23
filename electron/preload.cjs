const { contextBridge, ipcRenderer } = require('electron');
let externalReceiver;
const pendingFiles=[];
ipcRenderer.on('external-music',(_event,files)=>{if(externalReceiver)externalReceiver(files);else pendingFiles.push(files);});
contextBridge.exposeInMainWorld('desktop', {
  openMusic: () => ipcRenderer.invoke('open-music'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openSoundFont: () => ipcRenderer.invoke('open-soundfont'),
  basicSoundFont: () => ipcRenderer.invoke('basic-soundfont'),
  onExternalMusic: callback => {externalReceiver=callback;for(const files of pendingFiles.splice(0))callback(files);},
  onPrepareClose: callback => ipcRenderer.on('prepare-close', () => Promise.resolve().then(callback).finally(() => ipcRenderer.send('ready-close'))),
  saveFile: (name, data, kind) => ipcRenderer.invoke('save-file', { name, data: Array.from(data), kind }),
  fullscreen: () => ipcRenderer.invoke('fullscreen')
});
