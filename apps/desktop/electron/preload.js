/**
 * @file preload.js
 * @description Secure Electron Preload Bridge using contextBridge.
 * Follows Principle of Least Privilege: NO raw Node.js API exposed directly to the DOM.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Send native desktop notification
  showNotification: (payload) => {
    ipcRenderer.send('show-notification', payload);
  },

  // Query native system specs (OS, RAM, Electron version)
  getSystemInfo: () => {
    return ipcRenderer.invoke('get-system-info');
  },

  // Update badge count
  updateBadge: (count) => {
    ipcRenderer.send('update-badge', { count });
  },

  // Environment identifier
  isElectron: true,
});
