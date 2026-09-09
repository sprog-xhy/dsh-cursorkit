/**
 * Keychain interface (T-040): OS credential storage, NEVER plaintext files.
 *
 * Tauri: `tauri-plugin-keyring`; Electron: `safeStorage`. The contract below
 * is what the renderer sees via IPC — the shell maps it onto the platform.
 *
 * @module @dsh-cursorkit/desktop/keyring
 */

export interface Keyring {
  /** Store a secret under a service+account key. Returns false on failure. */
  set(service: string, account: string, secret: string): Promise<boolean>;
  /** Retrieve a secret, or null when absent. */
  get(service: string, account: string): Promise<string | null>;
  /** Delete a secret. Returns true when deleted, false when absent. */
  delete(service: string, account: string): Promise<boolean>;
  /** Whether the underlying keychain is available. */
  available(): Promise<boolean>;
}

/** Credential keys used by the app (settings page displays only "configured?"). */
export const CREDENTIAL_SERVICES = {
  apiKeys: 'dsh-cursorkit.api-key',
  mcpTokens: 'dsh-cursorkit.mcp-token',
} as const;

/** Marker for "key configured" — the value itself never leaves the keychain. */
export const KEYCHAIN_PRESENT_MARKER = '__present__';
