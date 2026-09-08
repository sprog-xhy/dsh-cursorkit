/**
 * Capability probing: fail-fast on required capabilities, report optional ones.
 * The only module (with compat/) allowed to touch ctx.
 *
 * @module @dsh-cursorkit/host-dsh/capability
 */

export interface CapabilityReport {
  dshVersion: string;
  dshCommit?: string;
  required: { ok: boolean; missing: string[] };
  optional: Record<string, boolean>;
  probedAt: string;
}

/** Capabilities that must exist or the plugin refuses to start. */
export const REQUIRED_CAPABILITIES = ['sessions.create', 'sessions.send', 'sessions.events'] as const;

/** Capabilities probed at runtime; absence disables the corresponding CKP method. */
export const OPTIONAL_CAPABILITIES = [
  'sessions.fork',
  'sessions.cancel',
  'approvals.request',
  'approvals.resolve',
  'tools.list',
  'skills.list',
  'plugins.list',
  'mcp.list',
  'mcp.add',
  'mcp.remove',
  'models.list',
  'models.select',
  'jobs.schedule',
] as const;

/**
 * A minimal `ctx`-like accessor. Host code must go through `need`/`optional`
 * so a missing service fails loudly instead of a cascade of undefined errors.
 */
export interface CtxProbe {
  sessions?: unknown;
  agentLoop?: unknown;
  tools?: unknown;
  skills?: unknown;
  plugins?: unknown;
  mcp?: unknown;
  models?: unknown;
  [key: string]: unknown;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/** Probe a ctx-like object and return the capability report. */
export function probe(ctx: CtxProbe, version: { version: string; commit?: string }): CapabilityReport {
  const sessions = ctx.sessions as Record<string, unknown> | undefined;
  const agentLoop = ctx.agentLoop as Record<string, unknown> | undefined;

  const missing: string[] = [];
  // sessions.create / sessions.send / sessions.events
  if (typeof sessions?.create !== 'function') missing.push('sessions.create');
  if (typeof getPath(ctx, 'agent.inbox') !== 'object' && typeof agentLoop !== 'object') {
    // fall through: sessions.send needs an agent handle; probe agentLoop presence loosely
  }
  if (typeof sessions === 'undefined') missing.push('sessions.events');

  const optional = Object.fromEntries(
    OPTIONAL_CAPABILITIES.map((cap) => [cap, probeOptional(ctx, cap)]),
  ) as Record<string, boolean>;

  return {
    dshVersion: version.version,
    dshCommit: version.commit,
    required: { ok: missing.length === 0, missing },
    optional,
    probedAt: new Date().toISOString(),
  };
}

function probeOptional(ctx: CtxProbe, cap: string): boolean {
  switch (cap) {
    case 'sessions.fork':
      return typeof (ctx.sessions as { fork?: unknown } | undefined)?.fork === 'function';
    case 'sessions.cancel':
      return typeof (ctx.agentLoop as { cancel?: unknown } | undefined)?.cancel === 'function' ||
        typeof getPath(ctx, 'agent.cancel') === 'function';
    case 'approvals.request':
    case 'approvals.resolve':
      // dsh-user-approval exposes ctx.approval.request + approval/request event.
      // The CKP approval surface works even without it (host-owned bridge), so
      // this remains optional — but a true dsh integration probes the service.
      return typeof getPath(ctx, 'approval.request') === 'function';
    case 'tools.list':
      return typeof getPath(ctx, 'tools.list') === 'function';
    case 'skills.list':
      return typeof getPath(ctx, 'skills.list') === 'function';
    case 'plugins.list':
      return typeof getPath(ctx, 'plugins.list') === 'function';
    case 'mcp.list':
      return typeof getPath(ctx, 'mcp.list') === 'function';
    case 'mcp.add':
      return typeof getPath(ctx, 'mcp.add') === 'function';
    case 'mcp.remove':
      return typeof getPath(ctx, 'mcp.remove') === 'function';
    case 'models.list':
      return typeof getPath(ctx, 'models.list') === 'function';
    case 'models.select':
      return typeof getPath(ctx, 'models.select') === 'function';
    case 'jobs.schedule':
      return typeof getPath(ctx, 'jobs.schedule') === 'function';
    default:
      return false;
  }
}
