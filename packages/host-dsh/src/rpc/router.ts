/**
 * RPC router: dispatch CKP methods to handlers, with capability gating.
 *
 * @module @dsh-cursorkit/host-dsh/rpc/router
 */

import {
  CkpError,
  type CkpMethodName,
  type ParamsOf,
  type ResultOf,
} from '@dsh-cursorkit/protocol';
import type { ApprovalBridge } from '../bridge/approval-bridge.ts';
import type { CapabilityReport } from '../capability.ts';
import type { EventBus } from './sse.ts';
import type { SessionStoreView, AgentView, AgentRegistryView } from '../compat/sessions.ts';
import { computeFileChanges } from '../diff/git-diff.ts';

export interface RouterServices {
  sessions: SessionStoreView;
  agents: AgentRegistryView;
  approvals: ApprovalBridge;
  bus: EventBus;
  capabilities: CapabilityReport;
  dshVersion: string;
}

type Handler<M extends CkpMethodName> = (
  params: ParamsOf<M>,
  svc: RouterServices,
) => Promise<ResultOf<M>> | ResultOf<M>;

/** Methods gated behind optional capabilities: method → capability name. */
const CAPABILITY_GATE: Partial<Record<CkpMethodName, string>> = {
  'session.fork': 'sessions.fork',
  'session.cancel': 'sessions.cancel',
  'approval.respond': 'approvals.resolve',
  'plugin.list': 'plugins.list',
  'skill.list': 'skills.list',
  'mcp.list': 'mcp.list',
  'mcp.add': 'mcp.add',
  'mcp.remove': 'mcp.remove',
  'model.list': 'models.list',
  'model.select': 'models.select',
};

export class Router {
  private readonly handlers = new Map<CkpMethodName, Handler<CkpMethodName>>();

  constructor(private readonly services: RouterServices) {
    this.registerDefaultHandlers();
  }

  register<M extends CkpMethodName>(method: M, handler: Handler<M>): void {
    this.handlers.set(method, handler as unknown as Handler<CkpMethodName>);
  }

  /** Dispatch a method call, returning the result or throwing CkpError. */
  async dispatch<M extends CkpMethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const gate = CAPABILITY_GATE[method];
    if (gate && !this.services.capabilities.optional[gate]) {
      throw new CkpError('CAPABILITY_MISSING', undefined, [gate]);
    }
    const handler = this.handlers.get(method);
    if (!handler) {
      throw new CkpError('INTERNAL', `no handler registered for method ${method}`);
    }
    return (await handler(params, this.services)) as ResultOf<M>;
  }

  private registerDefaultHandlers(): void {
    const svc = this.services;

    this.register('session.list', () => {
      return svc.sessions.list().map((s) => ({
        id: s.id,
        workspace: s.header?.cwd ?? '',
        model: undefined,
        createdAt: s.header?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        status: 'idle' as const,
        summary: undefined,
      }));
    });

    this.register('session.create', (params) => {
      const s = svc.sessions.create(undefined, {
        meta: { cwd: params.workspace },
      });
      return {
        id: s.id,
        workspace: params.workspace,
        model: params.model,
        createdAt: s.header?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        status: 'idle' as const,
      };
    });

    this.register('session.get', (params) => {
      const s = svc.sessions.get(params.id);
      if (!s) throw new CkpError('SESSION_NOT_FOUND', `session ${params.id} not found`);
      return {
        id: s.id,
        workspace: s.header?.cwd ?? '',
        createdAt: s.header?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        status: 'idle' as const,
        lastSeq: s.seq,
      };
    });

    this.register('session.fork', (params) => {
      if (!svc.sessions.fork) throw new CkpError('CAPABILITY_MISSING', undefined, ['sessions.fork']);
      const child = svc.sessions.fork(params.id, params.fromSeq);
      return {
        id: child.id,
        workspace: child.header?.cwd ?? '',
        createdAt: child.header?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        status: 'idle' as const,
      };
    });

    this.register('session.close', (params) => {
      // SessionStore has no close(); dispose semantics are handled by the agent
      // lifecycle. Report success — sessions are removed by dsh itself.
      void params;
      return undefined;
    });

    this.register('session.send', (params) => {
      const s = svc.sessions.get(params.id);
      if (!s) throw new CkpError('SESSION_NOT_FOUND', `session ${params.id} not found`);
      const message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user' as const,
        // dsh Message requires a source; user messages carry kind 'user'.
        source: { kind: 'user' as const },
        content: [{ type: 'text' as const, text: params.text }],
        createdAt: Date.now(),
      };
      const agentFor = svc.agents.get(params.id) ??
        svc.agents.list().find((a) => (a as { session?: { id: string } }).session?.id === params.id);
      const target = agentFor as AgentView | undefined;
      if (target?.send) {
        target.send(message, 'next-turn', true);
      } else if (target?.inbox?.append) {
        target.inbox.append('next-turn', message);
      } else {
        throw new CkpError('CAPABILITY_MISSING', `no live agent for session ${params.id}`, ['sessions.send']);
      }
      // Broadcast the user message so all subscribers see it in the stream.
      svc.bus.emit({
        sessionId: params.id,
        type: 'message.user',
        text: params.text,
        attachments: params.attachments,
        mentions: params.mentions,
      } as never);
      return { messageId: message.id };
    });

    this.register('session.cancel', async (params) => {
      const loop = (svc as unknown as { agentLoop?: { cancel?: (o?: unknown) => Promise<void> } }).agentLoop;
      if (typeof loop?.cancel === 'function') {
        await loop.cancel({ keepInbox: false });
        return undefined;
      }
      const target = svc.agents.get(params.id) as AgentView | undefined;
      if (typeof target?.cancel === 'function') {
        await target.cancel({ keepInbox: false });
        return undefined;
      }
      throw new CkpError('CAPABILITY_MISSING', undefined, ['sessions.cancel']);
    });

    this.register('approval.respond', (params) => {
      const ok = svc.approvals.respond(params.approvalId, params.decision);
      if (!ok) throw new CkpError('APPROVAL_NOT_FOUND', `approval ${params.approvalId} not found`);
      return undefined;
    });

    this.register('workspace.list', () => {
      // Host knows the cwd of live sessions; a real implementation lists
      // recent workspaces from dsh config. Empty list is a valid default.
      return [];
    });

    this.register('workspace.select', (params) => ({ path: params.path, name: params.path.split('/').pop() ?? params.path }));

    this.register('model.list', () => []);
    this.register('model.select', () => undefined);
    this.register('config.get', () => ({}));
    this.register('config.set', (params) => params.patch);
    this.register('plugin.list', () => []);
    this.register('skill.list', () => []);
    this.register('mcp.list', () => []);
    this.register('mcp.add', (params) => ({
      id: `mcp-${Date.now()}`,
      name: params.name,
      transport: params.transport,
      command: params.command,
      url: params.url,
      enabled: true,
    }));
    this.register('mcp.remove', () => undefined);
    this.register('checkpoint.list', () => []);
    this.register('checkpoint.restore', () => {
      throw new CkpError('CAPABILITY_MISSING', 'checkpoint.restore requires M2 plugins', ['checkpoint.restore']);
    });
    this.register('worktree.list', () => []);
    this.register('worktree.create', (params) => ({
      name: params.name,
      path: `.worktrees/${params.name}`,
      branch: params.name,
    }));
    this.register('worktree.remove', () => undefined);
    this.register('diff.get', async (params) => {
      // Compute diff from the session's workspace (git-based).
      if (params.sessionId) {
        const s = svc.sessions.get(params.sessionId);
        const workspace = s?.header?.cwd;
        if (workspace) {
          const changes = await computeFileChanges({ cwd: workspace });
          if (changes.length > 0) return changes;
        }
      }
      return [];
    });
  }
}
