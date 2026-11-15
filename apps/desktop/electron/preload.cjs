/**
 * Secure Electron Preload Bridge (CommonJS) - Principle of Least Privilege.
 * Exposes only minimal, validated IPC methods to renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

function safeString(v, max = 500) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

// Backend API base URL is resolved in the main process and passed via
// additionalArguments (`--deplo-api-url=...`). Sandboxed preloads still have
// access to process.argv, so we can read it here without extra IPC.
function readApiUrlFromArgv() {
  const arg = (process.argv || []).find((a) => a.startsWith('--deplo-api-url='));
  if (!arg) return '';
  const value = arg.slice('--deplo-api-url='.length).trim().replace(/\/$/, '');
  return /^https?:\/\//i.test(value) ? value : '';
}

const apiBaseUrl = readApiUrlFromArgv();

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  apiBaseUrl,

  getApiBaseUrl: () => ipcRenderer.invoke('desktop:get-api-url'),

  setApiBaseUrl: (url) => ipcRenderer.invoke('desktop:set-api-url', safeString(url, 2048)),

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
