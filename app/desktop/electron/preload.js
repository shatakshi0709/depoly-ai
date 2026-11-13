/**
 * Secure Electron Preload Bridge (CommonJS) - Principle of Least Privilege.
 * Exposes only minimal, validated IPC methods to renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

function safeString(v, max = 500) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  showNotification: (payload = {}) => {
    ipcRenderer.send('desktop:notify', {
      title: safeString(payload.title, 120),
      body: safeString(payload.body, 500),
      status: safeString(payload.status, 30),
    });
  },

  updateBadge: (count) => {
    const n = Number.isFinite(Number(count)) ? Math.max(0, Math.min(99, Math.floor(Number(count)))) : 0;
    ipcRenderer.send('desktop:badge', n);
  },

  getSystemInfo: () => ipcRenderer.invoke('desktop:system-info'),

  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', safeString(url, 2048)),

  getAppInfo: () => ipcRenderer.invoke('desktop:app-info'),
});
