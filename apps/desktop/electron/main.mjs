/**
 * Electron main process: window shell + sidecar manager + keychain IPC.
 *
 * This is the concrete implementation of the desktop shell contracts
 * (src/sidecar.ts, src/keyring.ts). It:
 *  1. Reads $DSH_HOME/.cursorkit/runtime.json to find a running sidecar, or
 *     spawns `dsh --profile cursorkit` itself (best-effort).
 *  2. Serves the built web UI (apps/web/dist) in a native window.
 *  3. Exposes keychain IPC to the renderer for API keys (never plaintext).
 *
 * @module desktop-electron/main
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createServer } from 'node:http';
import { createTray, registerGlobalShortcuts, unregisterGlobalShortcuts, openNewWindow } from './shell-extras.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
// Packaged build: web dist ships as an extraResource under resourcesPath.
const PACKAGED_WEB_DIST = process.resourcesPath ? join(process.resourcesPath, 'web-dist') : null;
const WEB_DIST = existsSync(join(PACKAGED_WEB_DIST ?? '', 'index.html'))
  ? PACKAGED_WEB_DIST
  : join(APP_ROOT, '..', 'web', 'dist');

/**
 * Serve the built web UI over localhost HTTP. Electron cannot dynamically
 * import ESM modules from file:// (CORS blocks it), so the renderer loads
 * from a loopback static server instead.
 */
function createStaticServer(rootDir) {
  const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    if (path === '/') path = '/index.html';
    // Prevent path traversal.
    const abs = join(rootDir, path);
    if (!abs.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    if (!existsSync(abs)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const data = readFileSync(abs);
    res.writeHead(200, {
      'content-type': MIME[extname(abs)] ?? 'application/octet-stream',
      'content-length': data.length,
      'access-control-allow-origin': '*',
    });
    res.end(data);
  });
  return server;
}

// ── Sidecar management ───────────────────────────────────────────
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const RUNTIME_FILE = join(DSH_HOME, '.cursorkit', 'runtime.json');

function readRuntime() {
  try {
    if (!existsSync(RUNTIME_FILE)) return null;
    const parsed = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
    if (typeof parsed.port !== 'number' || typeof parsed.token !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let sidecar = null;

async function healthCheck(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure a healthy sidecar: reuse an existing runtime.json instance, else
 * spawn `dsh --profile cursorkit`. Returns the connection info.
 */
async function ensureSidecar() {
  const rt = readRuntime();
  if (rt && isPidAlive(rt.pid) && (await healthCheck(rt.port))) {
    return rt;
  }
  // Spawn a fresh sidecar.
  try {
    sidecar = spawn('dsh', ['--profile', 'cursorkit'], {
      env: { ...process.env, DSH_HOME },
      stdio: 'ignore',
    });
  } catch {
    return null;
  }
  // Poll for runtime.json (doc §3.2: ≤30s).
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const fresh = readRuntime();
    if (fresh && isPidAlive(fresh.pid) && (await healthCheck(fresh.port))) return fresh;
  }
  return null;
}

// ── Window ───────────────────────────────────────────────────────
let mainWindow = null;
let staticServer = null;
let staticPort = 0;
let tray = null;

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (mainWindow.isVisible()) mainWindow.hide();
  else mainWindow.show();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'dsh-cursorkit',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (existsSync(WEB_DIST) && staticPort > 0) {
    void mainWindow.loadURL(`http://127.0.0.1:${staticPort}/?dshHome=${encodeURIComponent(DSH_HOME)}`);
  } else if (existsSync(WEB_DIST)) {
    void mainWindow.loadFile(join(WEB_DIST, 'index.html'), {
      query: { dshHome: DSH_HOME },
    });
  } else {
    void mainWindow.loadURL('http://127.0.0.1:5173'); // vite dev fallback
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── Keychain IPC (T-040): in-memory + safeStorage-backed ──────────
const secretStore = new Map();

ipcMain.handle('keyring:set', (_e, service, account, secret) => {
  try {
    const { safeStorage } = require('electron');
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(secret).toString('base64')
      : secret;
    secretStore.set(`${service}:${account}`, encrypted);
    return true;
  } catch {
    secretStore.set(`${service}:${account}`, secret);
    return true;
  }
});

ipcMain.handle('keyring:get', (_e, service, account) => {
  const stored = secretStore.get(`${service}:${account}`);
  if (!stored) return null;
  try {
    const { safeStorage } = require('electron');
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(stored, 'base64'))
      : stored;
  } catch {
    return stored;
  }
});

ipcMain.handle('keyring:delete', (_e, service, account) => {
  return secretStore.delete(`${service}:${account}`);
});

ipcMain.handle('keyring:available', () => true);

// ── Sidecar IPC ──────────────────────────────────────────────────
ipcMain.handle('sidecar:info', async () => {
  const info = await ensureSidecar();
  return info ? { ...info, dshHome: DSH_HOME } : null;
});

// ── M5: tray / global shortcut / multi-window IPC ────────────────
ipcMain.handle('shell:new-window', (_e, view = 'chat') => {
  return openNewWindow(staticPort, DSH_HOME, view) ? true : false;
});

// ── Lifecycle ────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Serve the built web UI over loopback HTTP (ESM dynamic import works).
  const boot = () => {
    if (mainWindow && !mainWindow.isDestroyed()) return;
    createWindow();
  };
  if (existsSync(WEB_DIST)) {
    staticServer = createStaticServer(WEB_DIST);
    staticServer.listen(0, '127.0.0.1', () => {
      staticPort = staticServer.address().port;
      boot();
    });
  } else {
    boot();
  }

  // Tray (best-effort; some Linux DEs lack tray support).
  try {
    tray = createTray(
      toggleMainWindow,
      () => openNewWindow(staticPort, DSH_HOME, 'chat'),
      () => openNewWindow(staticPort, DSH_HOME, 'settings'),
      () => app.quit(),
    );
  } catch {
    tray = null;
  }

  // Global shortcut: Cmd/Ctrl+Shift+C toggles the main window.
  const registered = registerGlobalShortcuts(toggleMainWindow);
  if (!registered) console.warn('[desktop] global shortcut registration failed');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  unregisterGlobalShortcuts();
});

app.on('window-all-closed', () => {
  // Keep running in tray unless explicitly quitting.
  if (process.platform !== 'darwin' && !tray) app.quit();
});

app.on('before-quit', () => {
  if (sidecar) sidecar.kill('SIGTERM');
  if (staticServer) staticServer.close();
  if (tray) tray.destroy();
});
