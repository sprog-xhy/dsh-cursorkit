/**
 * Safe ctx access: `need` fails fast, `optional` returns undefined.
 * THE only module (with capability.ts) allowed to touch ctx.
 *
 * @module @dsh-cursorkit/host-dsh/compat/ctx
 */

export class CapabilityMissingError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`missing dsh capabilities: ${missing.join(', ')}`);
    this.name = 'CapabilityMissingError';
    this.missing = missing;
  }
}

/** Get a nested value, throwing CapabilityMissingError when absent. */
export function need<T>(ctx: unknown, path: string): T {
  const v = getPath(ctx, path);
  if (v === undefined || v === null) throw new CapabilityMissingError([path]);
  return v as T;
}

/** Get a nested value, returning undefined when absent. */
export function optional<T>(ctx: unknown, path: string): T | undefined {
  const v = getPath(ctx, path);
  return v === undefined ? undefined : (v as T);
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}
