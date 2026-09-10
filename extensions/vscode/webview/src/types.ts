/**
 * webview 共享类型（阶段三产物）。
 * 保持与 panel.ts 消息协议一致（handoff §1.3 禁止改动协议）。
 */

/** 消息渲染模型（协议不变）。 */
export interface ChatItem {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  toolName?: string;
  status?: string;
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
  status: string;
}

/** 模型（model.list）。 */
export interface ModelInfo {
  id: string;
  name: string;
  provider?: string;
}

/** 设置（settings.get）。 */
export interface SettingsData {
  rules: { global: string; project: string[] };
  config: { permissionMode: string; tabEnabled: boolean };
}

/** 连接状态。 */
export type ConnectionStatus = 'starting' | 'ready' | 'error' | 'stopped';

/** 模式。 */
export type ChatMode = 'ask' | 'edit' | 'agent';
