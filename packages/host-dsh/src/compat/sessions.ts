/**
 * Sessions compat: thin typed facade over ctx.sessions (SessionStore) and the
 * agent handle used for sending messages. See docs/dsh-capability-audit.md §3/§6.
 *
 * @module @dsh-cursorkit/host-dsh/compat/sessions
 */

import { need } from './ctx.ts';

/** Minimal view of a dsh Session we map to CKP Session. */
export interface DshSessionView {
  id: string;
  header?: { cwd?: string; createdAt?: number };
  seq: number;
  /** Full recovered event log (present on live dsh sessions). */
  events?: readonly unknown[];
  deriveMessages?: () => unknown[];
  append?: (type: string, data: unknown, opts?: unknown) => unknown;
}

export interface SessionStoreView {
  create(id?: string, options?: { meta?: { cwd?: string } }): DshSessionView;
  get(id: string): DshSessionView | undefined;
  list(): DshSessionView[];
  fork?(source: unknown, boundary?: number, childSessionId?: string): DshSessionView;
  flush?(session: DshSessionView): Promise<boolean>;
}

export interface AgentView {
  send?(message: unknown, target: 'next-turn' | 'next-step', wakeup: boolean): void;
  cancel?(options?: { keepInbox?: boolean }): Promise<void>;
  inbox?: { append?(target: 'next-turn' | 'next-step', message: unknown): void };
}

/** dsh's AgentRegistry (ctx.agents): get/list/create. */
export interface AgentRegistryView {
  get(id: string): AgentView | undefined;
  list(): AgentView[];
  create?(options: {
    sessionId: string;
    meta?: { cwd?: string; origin?: 'subagent' };
    agentOptions?: { provider?: string; model?: string; maxTokens?: number };
  }): Promise<unknown>;
}

export interface AgentLoopView {
  cancel?(options?: { keepInbox?: boolean }): Promise<void>;
}

/** Resolve the session store, failing fast when missing. */
export function sessions(ctx: unknown): SessionStoreView {
  return need<SessionStoreView>(ctx, 'sessions');
}

/** Resolve the agent registry (ctx.agents), failing fast when missing. */
export function agents(ctx: unknown): AgentRegistryView {
  return need<AgentRegistryView>(ctx, 'agents');
}

/** Find the live agent driving a session, if any. */
export function agentForSession(ctx: unknown, sessionId: string): AgentView | undefined {
  const registry = optionalView(ctx, 'agents') as AgentRegistryView | undefined;
  if (!registry) return undefined;
  return registry.get(sessionId) ?? registry.list().find((a) => (a as { session?: { id: string } }).session?.id === sessionId);
}

/** Resolve the agent loop (cancel support), optional. */
export function agentLoop(ctx: unknown): AgentLoopView | undefined {
  return optionalView(ctx, 'agentLoop') as AgentLoopView | undefined;
}

function optionalView(ctx: unknown, path: string): unknown {
  const v = (function getPath(o: unknown, p: string): unknown {
    return p.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, o);
  })(ctx, path);
  return v === undefined ? undefined : v;
}

/** Flatten dsh session list to CKP Session records. */
export function toCkpSession(s: DshSessionView): {
  id: string;
  workspace: string;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'running' | 'done';
  lastSeq: number;
} {
  return {
    id: s.id,
    workspace: s.header?.cwd ?? '',
    createdAt: s.header?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    status: 'idle',
    lastSeq: s.seq,
  };
}
