/**
 * Write/remove the runtime.json discovery file (0600).
 *
 * @module @dsh-cursorkit/host-dsh/runtime-file
 */

import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CKP_PROTOCOL_VERSION } from '@dsh-cursorkit/protocol';

export interface RuntimeInfo {
  pid: number;
  port: number;
  token: string;
  protocolVersion: string;
  dshVersion: string;
  dshCommit?: string;
  startedAt: string;
  pidfile: string;
}

/** Generate a fresh 64-hex token. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Atomically write runtime.json with 0600 permissions.
 * @param file - absolute path (parent dirs are created).
 */
export async function writeRuntimeFile(file: string, info: RuntimeInfo): Promise<void> {
  const abs = resolve(file);
  await mkdir(dirname(abs), { recursive: true, mode: 0o700 });
  const payload = JSON.stringify(info, null, 2) + '\n';
  const tmp = `${abs}.tmp-${process.pid}`;
  await writeFile(tmp, payload, { mode: 0o600 });
  await rm(abs, { force: true });
  await writeFile(abs, payload, { mode: 0o600 });
  await rm(tmp, { force: true });
}

/** Remove runtime.json if present. */
export async function removeRuntimeFile(file: string): Promise<void> {
  await rm(resolve(file), { force: true });
}

/** Read an existing runtime.json (for reuse detection). */
export async function readRuntimeFile(file: string): Promise<RuntimeInfo | null> {
  try {
    const raw = await readFile(resolve(file), 'utf8');
    const parsed = JSON.parse(raw) as Partial<RuntimeInfo>;
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.port !== 'number' ||
      typeof parsed.token !== 'string'
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      token: parsed.token,
      protocolVersion: parsed.protocolVersion ?? CKP_PROTOCOL_VERSION,
      dshVersion: parsed.dshVersion ?? 'unknown',
      dshCommit: parsed.dshCommit,
      startedAt: parsed.startedAt ?? new Date().toISOString(),
      pidfile: parsed.pidfile ?? `${dirname(resolve(file))}/host.pid`,
    };
  } catch {
    return null;
  }
}
