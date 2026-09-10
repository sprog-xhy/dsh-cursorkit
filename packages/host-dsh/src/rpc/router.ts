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
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { ApprovalBridge } from '../bridge/approval-bridge.ts';
import type { CapabilityReport } from '../capability.ts';
import type { EventBus } from './sse.ts';
import type { SessionStoreView, AgentView, AgentRegistryView } from '../compat/sessions.ts';
import { translateRawEvent, type RawSessionEvent } from '../bridge/session-bridge.ts';
import { computeFileChanges } from '../diff/git-diff.ts';
import { listCheckpoints, restoreCheckpoint } from '../checkpoint/git-checkpoint.ts';
import { listWorktrees, createWorktree, removeWorktree } from '../worktree/git-worktree.ts';
import { cleanSessionTitle } from '../session-index.ts';

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
  /** 会话索引（落盘；重启后仍可列出/回读历史会话）。 */
  sessionIndex?: {
    get(id: string):
      | { model: string; workspace: string; createdAt: number; title?: string }
      | undefined;
    modelOf(id: string): string | undefined;
    /** 会话标题（dsh session/title 捕获）。 */
    titleOf?(id: string): string | undefined;
    setTitle?(id: string, title: string): void;
    set(id: string, entry: { model: string; workspace: string; createdAt: number }): void;
    all(): [string, { model: string; workspace: string; createdAt: number; title?: string }][];
  };
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
  // model.list/select 由 host 自己实现（读 settings.yaml），不 gate
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
      const live = svc.sessions.list();
      const liveIds = new Set(live.map((s) => s.id));
      const rows = live.map((s) => ({
        id: s.id,
        workspace: s.header?.cwd ?? '',
        model: svc.sessionIndex?.modelOf(s.id),
        createdAt: s.header?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        status: 'idle' as const,
        summary: svc.sessionIndex?.titleOf?.(s.id),
      }));
      // 补齐"已持久化但未载入内存"的历史会话（dsh 重启后不会自动载入）
      for (const [id, entry] of svc.sessionIndex?.all() ?? []) {
        if (liveIds.has(id)) continue;
        rows.push({
          id,
          workspace: entry.workspace,
          model: entry.model,
          createdAt: entry.createdAt,
          updatedAt: entry.createdAt,
          status: 'idle' as const,
          summary: entry.title,
        });
      }
      return rows;
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
      const model = parseModelRef(params.model);
      await svc.agents.create({
        sessionId,
        meta: { cwd: params.workspace },
        agentOptions: {
          ...(model.provider ? { provider: model.provider } : {}),
          model: model.model,
          maxTokens: 8192,
        },
      });
      // 记录到会话索引（供 session.get/list 回读，且重启后历史不丢）
      svc.sessionIndex?.set(sessionId, {
        model: model.full,
        workspace: params.workspace,
        createdAt: Date.now(),
      });
      const s = svc.sessions.get(sessionId);
      return {
        id: sessionId,
        workspace: params.workspace,
        model: model.full,
        createdAt: s?.header?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        status: 'idle' as const,
      };
    });

    this.register('session.get', (params) => {
      const s = svc.sessions.get(params.id);
      if (s) {
        return {
          id: s.id,
          workspace: s.header?.cwd ?? '',
          model: svc.sessionIndex?.modelOf(s.id),
          title: svc.sessionIndex?.titleOf?.(s.id),
          createdAt: s.header?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          status: 'idle' as const,
          lastSeq: s.seq,
        };
      }
      // 非活跃会话：用索引里的元数据回答（重启后仍可展示历史，lastSeq=0 表示需完整回放）
      const entry = svc.sessionIndex?.get(params.id);
      if (entry) {
        return {
          id: params.id,
          workspace: entry.workspace,
          model: entry.model,
          createdAt: entry.createdAt,
          updatedAt: entry.createdAt,
          status: 'idle' as const,
          lastSeq: 0,
        };
      }
      throw new CkpError('SESSION_NOT_FOUND', `session ${params.id} not found`);
    });

    /**
     * 会话历史回放（修复：dsh 重启后历史会话读不回来）。
     *
     * 流程：非活跃会话先用 `agents.resume` 从持久化载入 → 读 `session.events`（完整日志）
     * → 用 bridge 的 translateRawEvent 翻译成 CKP 事件 → 返回给客户端渲染。
     * 同时返回 EventBus 游标 busSeq，客户端据此订阅实时事件（不重复）。
     */
    this.register('session.history', async (params) => {
      const busSeq = svc.bus.lastSeq;
      let s = svc.sessions.get(params.id);
      let resumed = false;
      if (!s) {
        await restoreForSend(svc, params.id);
        s = svc.sessions.get(params.id);
        resumed = true;
      }
      if (!s) throw new CkpError('SESSION_NOT_FOUND', `session ${params.id} not found`);

      const raw = (s.events ?? []) as RawSessionEvent[];
      // 旧会话标题回填：标题捕获是后加的，此前创建的会话索引里没有标题。
      // 这里从原始事件里推导（session/title 优先，其次首条真实用户消息）。
      if (!svc.sessionIndex?.titleOf?.(params.id) && svc.sessionIndex?.setTitle) {
        const derived = deriveSessionTitle(raw);
        if (derived) svc.sessionIndex.setTitle(params.id, derived);
      }
      const limit = Math.max(1, params.limit ?? 2000);
      const from = raw.length > limit ? raw.length - limit : 0;
      const slice = raw.slice(from);

      const events: import('@dsh-cursorkit/protocol').CkpEvent[] = [];
      let seq = 0;
      for (const r of slice) {
        let translated: ReturnType<typeof translateRawEvent> = null;
        try {
          translated = translateRawEvent(params.id, r);
        } catch {
          translated = null;
        }
        if (!translated) continue;
        events.push({
          ...(translated as Record<string, unknown>),
          seq: ++seq,
          ts: typeof r.time === 'number' ? r.time : Date.now(),
        } as import('@dsh-cursorkit/protocol').CkpEvent);
      }
      return {
        id: params.id,
        events,
        busSeq,
        lastSeq: s.seq ?? 0,
        resumed,
        truncated: from > 0,
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
      let s = svc.sessions.get(params.id);
      if (!s) {
        // 历史会话（持久化但未载入内存）→ 先恢复，再继续；恢复不了才报 NOT_FOUND
        await restoreForSend(svc, params.id);
        s = svc.sessions.get(params.id);
      }
      if (!s) throw new CkpError('SESSION_NOT_FOUND', `session ${params.id} not found`);
      // 模式提示（V2-DECISIONS D15）：Ask=纯问答；Edit=聚焦修改；Agent=默认多文件
      const mode = params.mode ?? 'agent';
      const modeHint: Record<'ask' | 'edit' | 'agent', string> = {
        ask: '\n\n[模式: Ask] 只回答问题或解释代码，不要修改任何文件，不要调用写文件工具。',
        edit: '\n\n[模式: Edit] 专注修改用户指出的内容。先说明要改什么，改动要最小化、精确。',
        // 注意：不要写成"这是多文件任务"——纯问答（如"解释架构"）会被误导去修改文件
        // （实测：用户问"解释这个项目的架构"，模型据此去 str_replace_editor 改文件）
        agent:
          '\n\n[模式: Agent] 如果这个请求需要改动代码，先给出简明计划（编号列出要改的文件与要点）再逐项执行；' +
          '如果只是提问或要求解释，直接回答，不要修改任何文件。',
      };
      let text = `${params.text}${modeHint[mode] ?? ''}`;
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
      let agentFor = svc.agents.get(params.id) ??
        svc.agents.list().find((a) => (a as { session?: { id: string } }).session?.id === params.id);
      if (!agentFor) {
        // 历史会话（持久化但未载入内存）→ 先恢复 agent 再发送
        agentFor = await restoreForSend(svc, params.id);
      }
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

    this.register('model.list', () => {
      // 从 settings.yaml 读取 provider×model 列表（V2-DECISIONS D17）。
      // 格式：llm-pi-ai.providers.<provider>.models[].id
      try {
        const raw = readFileSync(settingsFile(), 'utf8');
        const providers = parseSettingsProviders(raw);
        return providers;
      } catch {
        return [];
      }
    });
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

/**
 * 为非活跃会话恢复 agent（历史会话继续对话的关键）。
 *
 * dsh 重启后不会把持久化会话载入内存，`agents.resume({ resumeSessionId })`
 * 会从持久化存储加载会话并新建 agent；失败返回 undefined（由调用方报错）。
 */
async function restoreForSend(svc: RouterServices, sessionId: string): Promise<AgentView | undefined> {
  const entry = svc.sessionIndex?.get(sessionId);
  // 索引里没有 → 不是我们创建过的会话，不尝试恢复（交由调用方报 NOT_FOUND）
  if (!entry) return undefined;
  const registry = svc.agents as AgentRegistryView & {
    resume?: (opts: {
      resumeSessionId: string;
      agentOptions?: { provider?: string; model?: string };
    }) => Promise<unknown>;
  };
  if (typeof registry.resume !== 'function') return undefined;
  const model = parseModelRef(entry.model);
  try {
    await registry.resume({
      resumeSessionId: sessionId,
      ...(model.provider
        ? { agentOptions: { provider: model.provider, model: model.model } }
        : { agentOptions: { model: model.model } }),
    });
  } catch (err) {
    // 已索引说明确实存在过；恢复失败要给出可诊断的错误，而不是含糊的 NOT_FOUND
    throw new CkpError(
      'SESSION_NOT_FOUND',
      `会话 ${sessionId} 无法恢复：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return svc.agents.get(sessionId) ??
    svc.agents.list().find((a) => (a as { session?: { id: string } }).session?.id === sessionId);
}

/** settings.yaml 路径（$DSH_HOME/settings.yaml，环境变量解析）。 */
function settingsFile(): string {
  const home = process.env.DSH_HOME ?? resolve(process.env.HOME ?? '/', '.dsh-cursorkit');
  return resolve(home, 'settings.yaml');
}

/**
 * 轻量解析 settings.yaml 的 llm-pi-ai.providers 段 → ModelInfo[]。
 * 只做缩进结构扫描（settings.yaml 由 dsh 管理、格式稳定），不引 YAML 依赖。
 */
export function parseSettingsProviders(raw: string): {
  id: string;
  name: string;
  provider: string;
}[] {
  const out: { id: string; name: string; provider: string }[] = [];
  const lines = raw.split('\n');
  let inProviders = false;
  let currentProvider = '';
  let inModels = false;

  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const text = line.trim();
    if (text === '' || text.startsWith('#')) continue;

    // llm-pi-ai:
    if (indent === 0 && text === 'llm-pi-ai:') {
      inProviders = false;
      continue;
    }
    // providers:
    if (indent === 2 && text === 'providers:') {
      inProviders = true;
      inModels = false;
      continue;
    }
    if (!inProviders) continue;
    // <provider>:
    if (indent === 4 && text.endsWith(':')) {
      currentProvider = text.slice(0, -1);
      inModels = false;
      continue;
    }
    // models:
    if (indent === 6 && text === 'models:') {
      inModels = true;
      continue;
    }
    // - id: xxx
    if (inModels && indent === 8 && text.startsWith('- id:')) {
      const id = text.replace('- id:', '').trim();
      if (id) {
        out.push({ id, name: id, provider: currentProvider });
      }
    }
  }
  return out;
}

/** 默认模型（provider/model-id）。 */
export const DEFAULT_MODEL = 'wps/moonshot/kimi-k2.7-code';

/**
 * 解析模型引用 `provider/model-id`（model-id 可含 '/'）。
 * 无 '/' 时视为「只有模型 id、无 provider」（原先会产出 provider=整串 + model='' 的坏配置）。
 */
/**
 * 从会话原始事件里推导标题（用于旧会话回填）。
 * 优先 dsh 的 session/title，其次首条真实用户消息。
 */
export function deriveSessionTitle(events: readonly unknown[]): string | undefined {
  let firstUser = '';
  for (const e of events) {
    const ev = e as { type?: string; data?: Record<string, unknown> };
    if (ev.type === 'session/title') {
      const t = cleanSessionTitle(String((ev.data as { title?: string } | undefined)?.title ?? ''));
      if (t) return t;
    }
    if (!firstUser && ev.type === 'user/message') {
      const d = (ev.data ?? {}) as {
        source?: { kind?: string };
        content?: { type?: string; text?: string }[];
        text?: string;
      };
      if (d.source?.kind === 'user' || d.source === undefined) {
        const text =
          (d.content ?? []).map((b) => (typeof b?.text === 'string' ? b.text : '')).join('') ||
          String(d.text ?? '');
        const cleaned = cleanSessionTitle(text);
        if (cleaned) firstUser = cleaned;
      }
    }
  }
  return firstUser || undefined;
}

export function parseModelRef(ref?: string): { provider?: string; model: string; full: string } {
  const raw = (ref ?? '').trim() || DEFAULT_MODEL;
  const slash = raw.indexOf('/');
  if (slash <= 0) return { model: raw, full: raw };
  const provider = raw.slice(0, slash);
  const model = raw.slice(slash + 1);
  return { provider, model, full: raw };
}
