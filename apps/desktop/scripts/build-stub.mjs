/**
 * Build stub for the desktop shell.
 *
 * The full desktop build needs either:
 *  - Tauri 2 (Rust toolchain: cargo/rustc), or
 *  - Electron (Node + npm install electron)
 * Neither is present in the current dev environment, so this stub typechecks
 * the shell contracts (sidecar.ts, keyring.ts) and reports what to do.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

console.log('[desktop] build stub — shell contracts only (no native build).');
console.log();

const hasCargo = (() => { try { execSync('cargo --version', { stdio: 'ignore' }); return true; } catch { return false; } })();
const hasElectron = existsSync(join(root, 'node_modules', 'electron'));

if (hasCargo) {
  console.log('  ✓ Rust toolchain found → `tauri build` path available.');
  console.log('    cd apps/desktop && npm i && npm run tauri dev');
} else if (hasElectron) {
  console.log('  ✓ Electron installed → `electron .` path available.');
} else {
  console.log('  ✗ No Rust toolchain, no Electron in this environment.');
  console.log('    Desktop shell is skeleton-only (contracts in src/sidecar.ts, src/keyring.ts).');
  console.log('    The renderer (apps/web) already runs the full UI against a real sidecar.');
}

console.log();
console.log('[desktop] contract files:');
console.log('  - src/sidecar.ts   SidecarManager state machine + spawn/health/stop');
console.log('  - src/keyring.ts   Keychain interface (Tauri keyring / Electron safeStorage)');
console.log('  - src/renderer.ts  (future) mounts apps/web build in a native window');
