/**
 * @file main.js
 * @description Electron Main Process for deplo.ai Desktop Dashboard.
 * Course Subject: Interactive System Development (Electron Architecture, IPC, Native APIs)
 */

import { app, BrowserWindow, ipcMain, Notification, Tray, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'deplo.ai — Cloud Orchestration Desktop Console',
    backgroundColor: '#020617', // slate-950
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false, // Security best practice
      sandbox: false,
    },
  });

  // Load local Vite dev server in development or bundled files from web package
  const devUrl = 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow.loadFile(path.join(__dirname, '../../web/dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../web/dist/index.html')).catch(() => {
      mainWindow.loadURL(devUrl);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ==============================================================================
// IPC Communication Handlers (Interactive System Development)
// ==============================================================================

// 1. Native Desktop Notifications
ipcMain.on('show-notification', (event, { title, body, status }) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title || 'deplo.ai Deployment Alert',
      body: body || 'Pipeline status updated.',
      silent: false,
    });

    notification.show();
  }
});

// 2. Query System Information
ipcMain.handle('get-system-info', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    totalMemory: `${Math.round(process.getSystemMemoryInfo().total / 1024 / 1024)} GB`,
  };
});

// 3. Update macOS Dock Badge
ipcMain.on('update-badge', (event, { count }) => {
  if (app.dock) {
    app.dock.setBadge(count > 0 ? String(count) : '');
  }
});

// Application Lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
