/**
 * webview 共享类型。
 * 保持与扩展进程 postMessage 协议一致（handoff §1.3：不改协议，只修字段语义）。
 */

/** 消息渲染模型。 */
export interface ChatItem {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system' | 'thinking' | 'change';
  text: string;
  /** tool：输出文本（折叠区）。 */
  output?: string;
  /** tool：run 状态。 */
  status?: string;
  /** system：级别（error 用错误色）。 */
  level?: 'info' | 'error' | 'stopped';
  /** 助手消息：对应可重发的用户输入（重新生成用）。 */
  retryText?: string;
  /** change：被修改的文件路径与统计。 */
  path?: string;
  additions?: number;
  deletions?: number;
  /** 时间戳。 */
  ts?: number;
  /** dsh 轮次/步骤（用于把同一轮的内容归组，来自协议 CkpTurnStep）。 */
  turn?: number;
  step?: number;
}

/** 审查改动（review.list）。 */
export interface ReviewChange {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

/** Checkpoint（checkpoint.list）。 */
export interface CheckpointInfo {
  id: string;
  sessionId: string;
  summary: string;
  createdAt: number;
  commit?: string;
  reversible: boolean;
}

/** 会话（session.list）。 */
export interface SessionInfo {
  id: string;
  workspace: string;
  /** 会话标题（dsh session/title，用于列表展示）。 */
  summary?: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** 模型（model.list）。 */
export interface ModelInfo {
  id: string;
  name: string;
  provider?: string;
}

/** 设置（settings.get）。 */
export interface SettingsData {
  rules: { global: string; project: { name: string; globs?: string[] }[] };
  config: { permissionMode: string; tabEnabled: boolean };
}

/** 连接状态。 */
export type ConnectionStatus = 'starting' | 'ready' | 'error' | 'stopped';

/** 对话模式。 */
export type ChatMode = 'ask' | 'edit' | 'agent';

/** 模型全名（provider/model-id），与扩展进程约定一致。 */
export function fullModelName(model: ModelInfo): string {
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

/** 截断模型名用于顶栏显示。 */
export function shortModelName(model: string): string {
  const parts = model.split('/');
  return parts[parts.length - 1] || model;
}
