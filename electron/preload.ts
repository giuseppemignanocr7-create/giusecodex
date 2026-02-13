import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('giuseCoder', {
  platform: process.platform,
  isElectron: true,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  onServerStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('server-status', (_event, status) => callback(status));
  },
});
