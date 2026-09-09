/**
 * Tray + global shortcuts + multi-window (M5).
 *
 * - Tray: show/hide main window, quick actions (新建会话/设置/退出).
 * - Global shortcut: CmdOrCtrl+Shift+C toggles the main window from anywhere.
 * - Multi-window: createWindow can open additional windows (e.g. parallel view).
 *
 * @module desktop-electron/shell-extras
 */

import { Tray, Menu, globalShortcut, BrowserWindow, app, nativeImage } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createTray(onShow, onNewSession, onSettings, onQuit) {
  const iconPath = join(__dirname, '..', 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  const tray = new Tray(icon);

  tray.setToolTip('dsh-cursorkit');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 / 隐藏', click: onShow },
      { label: '新建会话', click: onNewSession },
      { label: '设置', click: onSettings },
      { type: 'separator' },
      { label: '退出', click: onQuit },
    ]),
  );
  tray.on('click', onShow);
  return tray;
}

/** Register a global shortcut that toggles the main window. */
export function registerGlobalShortcuts(onToggle) {
  const ok = globalShortcut.register('CommandOrControl+Shift+C', onToggle);
  return ok;
}

export function unregisterGlobalShortcuts() {
  globalShortcut.unregisterAll();
}

/**
 * Open a new window pointed at a specific view (chat/settings/parallel).
 * Each window is independent (multi-window support).
 */
export function openNewWindow(staticPort, dshHome, view = 'chat') {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: `dsh-cursorkit — ${view}`,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (staticPort > 0) {
    const url = `http://127.0.0.1:${staticPort}/?dshHome=${encodeURIComponent(dshHome)}&view=${view}`;
    void win.loadURL(url);
  }
  return win;
}
