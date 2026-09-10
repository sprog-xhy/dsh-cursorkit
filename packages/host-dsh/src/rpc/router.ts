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
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { ApprovalBridge } from '../bridge/approval-bridge.ts';
import type { CapabilityReport } from '../capability.ts';
import type { EventBus } from './sse.ts';
import type { SessionStoreView, AgentView, AgentRegistryView } from '../compat/sessions.ts';
import { computeFileChanges } from '../diff/git-diff.ts';
import { listCheckpoints, restoreCheckpoint } from '../checkpoint/git-checkpoint.ts';
import { listWorktrees, createWorktree, removeWorktree } from '../worktree/git-worktree.ts';

/** 单文件注入上限（防爆上下文）。 */
const CONTEXT_FILE_MAX_BYTES = 64 * 1024;
/** 注入文件数上限。 */
const CONTEXT_FILE_MAX_COUNT = 20;

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

    /** Resolve the "active" workspace: the most recently created live session's cwd. */
    const currentWorkspace = (s: RouterServices): string | undefined => {
      const list = s.sessions.list();
      if (list.length === 0) return undefined;
      const newest = [...list].sort((a, b) => (b.header?.createdAt ?? 0) - (a.header?.createdAt ?? 0))[0];
      return newest?.header?.cwd;
    };

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

    this.register('session.create', async (params) => {
      // 动态注册 live agent（dsh AgentRegistry.create，V2-DECISIONS D15）：
      // agents.create 的 factory 内部会同时创建 session + agent（sessionId+meta 传入），
      // 不要先 sessions.create —— 双重创建会因 id 冲突而失败。
      if (typeof svc.agents.create !== 'function') {
        throw new CkpError('CAPABILITY_MISSING', 'dsh AgentRegistry 未提供 create（agent factory 未注册）', [
          'agents.create',
        ]);
      }
      const sessionId = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      // model 格式：`provider/full-model-id`（如 wps/moonshot/kimi-k2.7-code）
      // 或 `provider/model`（如 wps/kimi-k2.7-code，模型 id 需在 settings 里存在）。
      // dsh 的 agentOptions.model 需要的是【模型完整 id】（如 moonshot/kimi-k2.7-code），
      // provider 单独传。settings.yaml 的 wps providers 里模型 id 自带供应商前缀。
      const model = params.model ?? 'wps/moonshot/kimi-k2.7-code';
      const [provider, ...modelParts] = model.split('/');
      const modelId = modelParts.join('/');
      await svc.agents.create({
        sessionId,
        meta: { cwd: params.workspace },
        agentOptions: {
          provider,
          model: modelId,
          maxTokens: 8192,
        },
      });
      const s = svc.sessions.get(sessionId);
      return {
        id: sessionId,
        workspace: params.workspace,
        model: params.model,
        createdAt: s?.header?.createdAt ?? Date.now(),
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

    this.register('session.send', async (params) => {
      const s = svc.sessions.get(params.id);
      if (!s) throw new CkpError('SESSION_NOT_FOUND', `session ${params.id} not found`);
      // 模式提示（V2-DECISIONS D15）：Ask=纯问答；Edit=聚焦修改；Agent=默认多文件
      const mode = params.mode ?? 'agent';
      const modeHint: Record<'ask' | 'edit' | 'agent', string> = {
        ask: '\n\n[模式: Ask] 只回答问题或解释代码，不要修改任何文件，不要调用写文件工具。',
        edit: '\n\n[模式: Edit] 专注修改用户指出的内容。先说明要改什么，改动要最小化、精确。',
        agent: '',
      };
      let text = `${params.text}${modeHint[mode]}`;
      const mentions = params.mentions ?? [];
      const fileMentions = mentions.filter((m) => m.startsWith('file:')).map((m) => m.slice(5));
      const cwd = s.header?.cwd;
      if (fileMentions.length > 0) {
        const injected: string[] = [];
        for (const f of fileMentions.slice(0, CONTEXT_FILE_MAX_COUNT)) {
          const abs = isAbsolute(f) ? f : cwd ? resolve(cwd, f) : resolve(f);
          try {
            const buf = await readFile(abs);
            const bytes = Math.min(buf.length, CONTEXT_FILE_MAX_BYTES);
            injected.push(`## 文件: ${f}\n\`\`\`\n${buf.toString('utf8', 0, bytes)}\n\`\`\``);
          } catch {
            injected.push(`## 文件: ${f}\n（读取失败）`);
          }
        }
        if (injected.length > 0) text = `${text}\n\n${injected.join('\n\n')}`;
      }
      const message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user' as const,
        // dsh Message requires a source; user messages carry kind 'user'.
        source: { kind: 'user' as const },
        content: [{ type: 'text' as const, text }],
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
        text,
        attachments: params.attachments,
        mentions: params.mentions,
      } as never);
      return { messageId: message.id };
    });

    this.register('context.get', async (params) => {
      const s = svc.sessions.get(params.sessionId);
      if (!s) throw new CkpError('SESSION_NOT_FOUND', `session ${params.sessionId} not found`);
      const cwd = s.header?.cwd;
      const filePaths = (params.files ?? []).slice(0, CONTEXT_FILE_MAX_COUNT);
      const parts: string[] = [];
      const readFiles: { path: string; bytes: number }[] = [];

      for (const f of filePaths) {
        const abs = isAbsolute(f) ? f : cwd ? resolve(cwd, f) : resolve(f);
        try {
          const buf = await readFile(abs);
          const bytes = Math.min(buf.length, CONTEXT_FILE_MAX_BYTES);
          parts.push(`## 文件: ${f}\n\`\`\`\n${buf.toString('utf8', 0, bytes)}\n\`\`\``);
          readFiles.push({ path: f, bytes: buf.length });
        } catch {
          parts.push(`## 文件: ${f}\n（读取失败：文件不存在或不可读）`);
        }
      }
      if (params.selection) {
        parts.push(`## 当前选中\n\`\`\`\n${params.selection}\n\`\`\``);
      }
      if (params.prompt) {
        parts.push(`## 补充上下文\n${params.prompt}`);
      }
      const summary =
        `注入 ${readFiles.length}/${filePaths.length} 个文件` +
        (params.selection ? ' + 选中文本' : '') +
        (params.prompt ? ' + 补充提示' : '');
      return {
        sessionId: params.sessionId,
        files: filePaths,
        selection: params.selection,
        prompt: params.prompt,
        injectedAt: Date.now(),
        summary,
      };
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
    this.register('checkpoint.list', async (params) => {
      const s = svc.sessions.get(params.sessionId);
      const workspace = s?.header?.cwd;
      if (workspace) {
        return await listCheckpoints(workspace, params.sessionId);
      }
      return [];
    });

    this.register('checkpoint.restore', async (params) => {
      // id format: <sessionId>-<n>; restore onto a new fork branch.
      const [sessionId, n] = params.id.split('-');
      const s = sessionId ? svc.sessions.get(sessionId) : undefined;
      const workspace = s?.header?.cwd;
      if (!workspace || !n) {
        throw new CkpError('SESSION_NOT_FOUND', `checkpoint ${params.id} not found`);
      }
      const commitRef = `refs/cursorkit/${sessionId}/${n}`;
      const branch = await restoreCheckpoint(workspace, commitRef);
      if (!branch) throw new CkpError('SESSION_NOT_FOUND', `checkpoint ${params.id} not found`);
      // Fork: create a child session from the current one (doc §M2-3).
      if (typeof svc.sessions.fork === 'function' && sessionId) {
        const forked = svc.sessions.fork(sessionId);
        return {
          id: forked.id,
          workspace: forked.header?.cwd ?? workspace,
          createdAt: forked.header?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          status: 'idle' as const,
        };
      }
      throw new CkpError('CAPABILITY_MISSING', undefined, ['sessions.fork']);
    });
    this.register('worktree.list', async () => {
      const workspace = currentWorkspace(svc);
      if (workspace) return await listWorktrees(workspace);
      return [];
    });

    this.register('worktree.create', async (params) => {
      const workspace = currentWorkspace(svc);
      if (!workspace) throw new CkpError('SESSION_NOT_FOUND', 'no active workspace session');
      const entry = await createWorktree(workspace, params.name, params.base);
      if (!entry) throw new CkpError('INTERNAL', `failed to create worktree ${params.name}`);
      return entry;
    });

    this.register('worktree.remove', async (params) => {
      const workspace = currentWorkspace(svc);
      if (!workspace) throw new CkpError('SESSION_NOT_FOUND', 'no active workspace session');
      const ok = await removeWorktree(workspace, params.name);
      if (!ok) throw new CkpError('INTERNAL', `failed to remove worktree ${params.name} (dirty?)`);
      return undefined;
    });
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
