/**
 * Sidecar manager contract (doc §3.3): spawn/health/restart/stop of the dsh
 * sidecar. Platform-independent — the Tauri (Rust) or Electron (Node) shell
 * implements this against the native process APIs.
 *
 * @module @dsh-cursorkit/desktop/sidecar
 */

export interface RuntimeInfo {
  pid: number;
  port: number;
  token: string;
  protocolVersion: string;
  dshVersion: string;
  startedAt: string;
}

export type SidecarState = 'stopped' | 'starting' | 'ready' | 'degraded' | 'restarting' | 'failed';

export interface SidecarManager {
  /** Ensure a healthy sidecar is running (reuse runtime.json or spawn). */
  start(): Promise<RuntimeInfo>;
  /** Health check (GET /health); returns false when unhealthy. */
  health(): Promise<boolean>;
  /** Graceful stop: POST /shutdown → SIGTERM → SIGKILL (doc §3.4). */
  stop(): Promise<void>;
  /** Current state machine value. */
  readonly state: SidecarState;
  /** Subscribe to state changes. */
  onStateChange(fn: (s: SidecarState) => void): () => void;
}

/** Spawn command for the sidecar (platform-adjusted by the shell). */
export const SIDECAR_SPAWN = ['dsh', '--profile', 'cursorkit'];

/**
 * IndexedDB-free discovery: read $DSH_HOME/.cursorkit/runtime.json.
 * The shell passes a resolved path via IPC to the renderer.
 */
export function runtimeJsonPath(dshHome: string): string {
  return `${dshHome}/.cursorkit/runtime.json`;
}
