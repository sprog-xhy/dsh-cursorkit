/**
 * Preload: expose a minimal, safe API to the renderer via contextBridge.
 * The renderer stays sandboxed (contextIsolation: true, nodeIntegration: false).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  /** Sidecar connection info (port/token) or null. */
  sidecarInfo: () => ipcRenderer.invoke('sidecar:info'),
  /** Keychain (T-040): set/get/delete secrets. */
  keyring: {
    set: (service, account, secret) => ipcRenderer.invoke('keyring:set', service, account, secret),
    get: (service, account) => ipcRenderer.invoke('keyring:get', service, account),
    delete: (service, account) => ipcRenderer.invoke('keyring:delete', service, account),
    available: () => ipcRenderer.invoke('keyring:available'),
  },
});
