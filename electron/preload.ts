import { contextBridge } from 'electron';

// Expose any needed APIs to the renderer process
// Currently, the app uses standard WebSocket which works in Electron
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
});
