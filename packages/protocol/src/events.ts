/**
 * CKP event types — the input to the front-end event-sourced reducer.
 *
 * Every event MUST carry a monotonic `seq` and an `ts` timestamp. The client
 * dedupes and resumes by `seq`.
 *
 * @module @dsh-cursorkit/protocol/events
 */

import type {
  ApprovalDecision,
  ApprovalRequest,
  Checkpoint,
  FileChange,
  Message,
  SessionStatus,
  ToolCall,
} from './domain.ts';

/** Base fields shared by every CKP event. */
export interface CkpEventBase {
  /** Monotonic, unique per host process. */
  seq: number;
  /** Epoch ms. */
  ts: number;
  sessionId: string;
}

/**
 * 轮次/步骤标记（可选，向后兼容）。
 *
 * dsh 的 agent 事件本身带 `{ turn, step }`；此前 bridge 丢弃了它们，
 * 导致前端无法把"同一轮里的文本与工具调用"归组，只能按到达顺序切块。
 * 这里透传出来供 UI 分组（老客户端忽略未知字段即可）。
 */
export interface CkpTurnStep {
  /** 第几轮对话（从 1 开始）。 */
  turn?: number;
  /** 该轮内的第几步（从 1 开始）。 */
  step?: number;
}

export type CkpEvent =
  | (CkpEventBase & { type: 'session.started'; workspace: string; model?: string })
  | (CkpEventBase & { type: 'message.user'; text: string; attachments?: unknown[]; mentions?: string[] })
  | (CkpEventBase & CkpTurnStep & { type: 'message.delta'; text: string })
  | (CkpEventBase & { type: 'message.done'; message: Message })
  | (CkpEventBase & CkpTurnStep & { type: 'thinking.delta'; text: string })
  | (CkpEventBase & CkpTurnStep & { type: 'thinking.done'; text: string })
  | (CkpEventBase & CkpTurnStep & { type: 'tool.call'; call: ToolCall })
  | (CkpEventBase & { type: 'tool.output'; callId: string; output: string; exitCode?: number })
  | (CkpEventBase & CkpTurnStep & { type: 'tool.done'; callId: string; status: ToolCall['status']; durationMs?: number; error?: string })
  | (CkpEventBase & { type: 'approval.request'; approval: ApprovalRequest })
  | (CkpEventBase & { type: 'approval.resolved'; approvalId: string; decision: ApprovalDecision })
  | (CkpEventBase & { type: 'file.changed'; change: FileChange })
  | (CkpEventBase & { type: 'checkpoint.created'; checkpoint: Checkpoint })
  | (CkpEventBase & { type: 'context.injected'; source: string; payload: unknown })
  | (CkpEventBase & { type: 'subagent.spawned'; subagentId: string; name: string })
  | (CkpEventBase & { type: 'subagent.done'; subagentId: string })
  | (CkpEventBase & { type: 'error'; message: string })
  | (CkpEventBase & { type: 'cancelled' })
  | (CkpEventBase & { type: 'done'; status: SessionStatus })
  /** Server tells the client its replay window has a gap → client must rebuild. */
  | (CkpEventBase & { type: 'gap'; fromSeq: number });

/** Sentinel emitted by the client for its own optimistic user messages. */
export interface LocalMessageEvent {
  seq: -1;
  ts: number;
  sessionId: string;
  type: 'message.user';
  text: string;
  /** Marks this as a client-local optimistic event not yet confirmed by the host. */
  local: true;
  localId: string;
}

export type StoreEvent = CkpEvent | LocalMessageEvent;

/** Narrow CkpEvent to a specific type. */
export type ExtractEvent<T extends CkpEvent['type']> = Extract<CkpEvent, { type: T }>;
