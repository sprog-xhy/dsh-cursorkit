/**
 * CKP method list — the single source of truth for method names and their
 * parameter/result types. The host router and the client SDK both derive from
 * this table.
 *
 * @module @dsh-cursorkit/protocol/methods
 */

import type {
  ApprovalDecision,
  Checkpoint,
  Config,
  FileChange,
  McpServerInfo,
  ModelInfo,
  PluginInfo,
  Session,
  SessionDetail,
  SkillInfo,
  Workspace,
} from './domain.ts';

/** Per-method parameter types. */
export interface MethodParams {
  'session.list': { workspace?: string; limit?: number; cursor?: string };
  'session.create': { workspace: string; model?: string; worktree?: string };
  'session.get': { id: string };
  'session.fork': { id: string; fromSeq?: number };
  'session.close': { id: string };
  'session.send': { id: string; text: string; attachments?: unknown[]; mentions?: string[] };
  'session.cancel': { id: string };
  'approval.respond': { approvalId: string; decision: ApprovalDecision };
  'workspace.list': Record<string, never>;
  'workspace.select': { path: string };
  'model.list': Record<string, never>;
  'model.select': { id: string };
  'config.get': { keys?: string[] };
  'config.set': { patch: Record<string, unknown> };
  'plugin.list': Record<string, never>;
  'skill.list': Record<string, never>;
  'mcp.list': Record<string, never>;
  'mcp.add': { name: string; transport: 'stdio' | 'streamable-http'; command?: string; url?: string };
  'mcp.remove': { id: string };
  'checkpoint.list': { sessionId: string };
  'checkpoint.restore': { id: string };
  'worktree.list': Record<string, never>;
  'worktree.create': { name: string; base?: string };
  'worktree.remove': { name: string };
  'diff.get': { sessionId?: string; checkpointId?: string };
  'context.get': { sessionId: string; files?: string[]; selection?: string; prompt?: string };
}

/** Per-method result types. */
export interface MethodResults {
  'session.list': Session[];
  'session.create': Session;
  'session.get': SessionDetail;
  'session.fork': Session;
  'session.close': void;
  'session.send': { messageId: string };
  'session.cancel': void;
  'approval.respond': void;
  'workspace.list': Workspace[];
  'workspace.select': Workspace;
  'model.list': ModelInfo[];
  'model.select': void;
  'config.get': Config;
  'config.set': Config;
  'plugin.list': PluginInfo[];
  'skill.list': SkillInfo[];
  'mcp.list': McpServerInfo[];
  'mcp.add': McpServerInfo;
  'mcp.remove': void;
  'checkpoint.list': Checkpoint[];
  'checkpoint.restore': Session;
  'worktree.list': { name: string; path: string; branch: string }[];
  'worktree.create': { name: string; path: string; branch: string };
  'worktree.remove': void;
  'diff.get': FileChange[];
  'context.get': {
    sessionId: string;
    /** 注入的文件路径列表（VSCode 相对 workspace 或绝对路径）。 */
    files?: string[];
    /** 当前选中文本。 */
    selection?: string;
    /** 注入的补充提示（如 @codebase 检索结果）。 */
    prompt?: string;
    injectedAt: number;
    /** 实际注入到 agent 上下文的内容（便于 UI 展示）。 */
    summary: string;
  };
}

/** Union of every method name. */
export type CkpMethodName = keyof MethodParams & keyof MethodResults;

/** Typed request helper: params for a method. */
export type ParamsOf<M extends CkpMethodName> = MethodParams[M];
/** Typed result helper: result of a method. */
export type ResultOf<M extends CkpMethodName> = MethodResults[M];

/** Every CKP method, for the host router to validate against. */
export const CKP_METHODS: readonly CkpMethodName[] = [
  'session.list',
  'session.create',
  'session.get',
  'session.fork',
  'session.close',
  'session.send',
  'session.cancel',
  'approval.respond',
  'workspace.list',
  'workspace.select',
  'model.list',
  'model.select',
  'config.get',
  'config.set',
  'plugin.list',
  'skill.list',
  'mcp.list',
  'mcp.add',
  'mcp.remove',
  'checkpoint.list',
  'checkpoint.restore',
  'worktree.list',
  'worktree.create',
  'worktree.remove',
  'diff.get',
];

/** Whether a method name is a known CKP method. */
export function isCkpMethod(method: string): method is CkpMethodName {
  return (CKP_METHODS as readonly string[]).includes(method);
}
