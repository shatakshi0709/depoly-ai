/**
 * Electron Main Process for deplo.ai Desktop Console (Phase 6).
 * Secure-by-default: contextIsolation, sandbox, no nodeIntegration, restricted navigation/IPC.
 */
import { app, BrowserWindow, ipcMain, Notification, shell, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_START_URL || 'http://localhost:5173';
const DIST_INDEX = path.resolve(__dirname, '../../web/dist/index.html');

// ── Backend API base URL resolution (packaged desktop app) ──────────────
// Priority: runtime env override -> persisted user config -> local dev default.
// localhost is only a local-development fallback; it is NOT a production URL.
// For distribution, configure a publicly reachable backend via DEPLO_API_URL
// or by persisting `{ "apiUrl": "https://..." }` in the user config file.
const DEFAULT_LOCAL_API_URL = 'http://localhost:5001';

function configFilePath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  try {
    const p = configFilePath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch {
    // ignore malformed config
  }
  return {};
}

function normalizeApiUrl(value) {
  const v = typeof value === 'string' ? value.trim().replace(/\/$/, '') : '';
  return /^https?:\/\//i.test(v) ? v : '';
}

function resolveApiBaseUrl() {
  const fromEnv = normalizeApiUrl(process.env.DEPLO_API_URL || process.env.VITE_API_URL);
  if (fromEnv) return fromEnv;
  const fromConfig = normalizeApiUrl(readConfig().apiUrl);
  if (fromConfig) return fromConfig;
  return DEFAULT_LOCAL_API_URL;
}

function isAllowedNavigation(targetUrl) {
  try {
    const u = new URL(targetUrl);
    const devOrigin = new URL(DEV_URL).origin;
    if (isDev && u.origin === devOrigin) return true;
    if (u.protocol === 'file:') return true;
    return false;
  } catch {
    return false;
  }
}

function createWindow() {
  const apiBaseUrl = resolveApiBaseUrl();

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'deplo.ai Desktop Console',
    backgroundColor: '#020617',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [`--deplo-api-url=${apiBaseUrl}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());

  // Restrict in-app navigation; open external links in system browser via explicit IPC.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL).catch(() => {
      if (fs.existsSync(DIST_INDEX)) mainWindow.loadFile(DIST_INDEX);
    });
  } else {
    const packagedIndex = path.join(process.resourcesPath, 'web-dist', 'index.html');
    if (fs.existsSync(packagedIndex)) {
      mainWindow.loadFile(packagedIndex);
    } else if (fs.existsSync(DIST_INDEX)) {
      mainWindow.loadFile(DIST_INDEX);
    } else {
      mainWindow.loadURL(DEV_URL).catch(() => {});
    }
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  try { Menu.setApplicationMenu(Menu.buildFromTemplate(template)); } catch { /* ignore */ }
}

// IPC: native notifications (validated/sanitized payload)
ipcMain.on('desktop:notify', (_event, payload = {}) => {
  try {
    if (!Notification.isSupported()) return;
    const title = typeof payload.title === 'string' && payload.title ? payload.title.slice(0, 120) : 'deplo.ai';
    const body = typeof payload.body === 'string' ? payload.body.slice(0, 500) : '';
    new Notification({ title, body, silent: false }).show();
  } catch { /* ignore */ }
});

// IPC: dock badge (macOS)
ipcMain.on('desktop:badge', (_event, count) => {
  try {
    if (app.dock) app.dock.setBadge(count > 0 ? String(count) : '');
  } catch { /* ignore */ }
});

// IPC: backend API base URL (runtime-configurable, persisted for the user)
ipcMain.handle('desktop:get-api-url', () => resolveApiBaseUrl());

ipcMain.handle('desktop:set-api-url', (_event, url) => {
  try {
    const normalized = normalizeApiUrl(url);
    if (!normalized) return { ok: false, error: 'Invalid URL' };
    const current = readConfig();
    fs.writeFileSync(configFilePath(), JSON.stringify({ ...current, apiUrl: normalized }, null, 2), 'utf8');
    return { ok: true, apiUrl: normalized };
  } catch {
    return { ok: false, error: 'Failed to persist URL' };
  }
});

// IPC: system/app info (no secrets)
ipcMain.handle('desktop:system-info', () => ({  platform: process.platform,
  arch: process.arch,
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  nodeVersion: process.versions.node,
  isPackaged: app.isPackaged,
}));

ipcMain.handle('desktop:app-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  locale: app.getLocale(),
}));

ipcMain.handle('desktop:open-external', async (_event, url) => {
  try {
    const u = String(url || '');
    if (/^https?:\/\//i.test(u)) {
      await shell.openExternal(u);
      return { ok: true };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
});

app.whenReady().then(() => {
  createMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
