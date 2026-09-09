/**
 * CKP domain models: Session, ToolCall, Approval, FileChange, Checkpoint, etc.
 *
 * @module @dsh-cursorkit/protocol/domain
 */

/** Workspace is a directory the user opened. */
export interface Workspace {
  /** Absolute path on the host machine. */
  path: string;
  /** Display name (usually the directory basename). */
  name: string;
  /** Short git branch/hash info when available. */
  gitBranch?: string;
  gitHead?: string;
}

export interface Session {
  id: string;
  workspace: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  /** Last message summary for the session list. */
  summary?: string;
  status: SessionStatus;
}

export type SessionStatus = 'idle' | 'running' | 'awaiting-approval' | 'done' | 'error' | 'cancelled';

export interface SessionDetail extends Session {
  /** Event seq the client should start subscribing from (inclusive replay). */
  lastSeq: number;
  worktree?: string;
}

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  /** Only set while the message is streaming. */
  pending?: boolean;
  error?: string;
  createdAt: number;
}

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error' | 'denied';

export interface ToolCall {
  callId: string;
  sessionId: string;
  name: string;
  args: unknown;
  status: ToolCallStatus;
  /** Accumulated output text (streamed). */
  output?: string;
  exitCode?: number;
  error?: string;
  durationMs?: number;
  startedAt?: number;
  finishedAt?: number;
}

export type ApprovalDecision = 'once' | 'session' | 'always' | 'deny';

/** Risk categories shown on the ApprovalCard. */
export type ApprovalRisk = 'write' | 'shell' | 'network' | 'other';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  tool: string;
  args: unknown;
  reason?: string;
  /** When the approval times out (epoch ms). */
  expiresAt: number;
  risks: ApprovalRisk[];
}

export type FileChangeStatus = 'pending' | 'kept' | 'rejected';

export interface FileChange {
  path: string;
  /** Unified diff text for this file. */
  patch: string;
  additions: number;
  deletions: number;
  status: FileChangeStatus;
  worktreeRef?: string;
}

export interface Checkpoint {
  id: string;
  sessionId: string;
  summary: string;
  createdAt: number;
  /** git commit-ish the checkpoint points at. */
  commit?: string;
  /** Whether restore is reversible (no network/DB side effects). */
  reversible: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** provider, e.g. 'deepseek', 'openai-compatible'. */
  provider?: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  version?: string;
  enabled: boolean;
}

export interface SkillInfo {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

export interface McpServerInfo {
  id: string;
  name: string;
  transport: 'stdio' | 'streamable-http';
  command?: string;
  url?: string;
  enabled: boolean;
}

export interface Config {
  /** Selected profile name. */
  profile?: string;
  /** Default model id. */
  model?: string;
  /** Active workspace path. */
  workspace?: string;
  /** Permission policy presets. */
  permissions?: Record<string, unknown>;
  [key: string]: unknown;
}
