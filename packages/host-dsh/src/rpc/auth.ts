/**
 * Bearer token auth for /v1/* routes.
 *
 * @module @dsh-cursorkit/host-dsh/rpc/auth
 */

import { timingSafeEqual } from 'node:crypto';

export interface AuthConfig {
  token: string;
}

/** Constant-time token comparison. */
export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Parse `Authorization: Bearer <token>` from a request header value. */
export function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1];
}
