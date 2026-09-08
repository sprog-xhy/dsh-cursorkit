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

export type CkpEvent =
  | (CkpEventBase & { type: 'session.started'; workspace: string; model?: string })
  | (CkpEventBase & { type: 'message.user'; text: string; attachments?: unknown[]; mentions?: string[] })
  | (CkpEventBase & { type: 'message.delta'; text: string })
  | (CkpEventBase & { type: 'message.done'; message: Message })
  | (CkpEventBase & { type: 'thinking.delta'; text: string })
  | (CkpEventBase & { type: 'thinking.done'; text: string })
  | (CkpEventBase & { type: 'tool.call'; call: ToolCall })
  | (CkpEventBase & { type: 'tool.output'; callId: string; output: string; exitCode?: number })
  | (CkpEventBase & { type: 'tool.done'; callId: string; status: ToolCall['status']; durationMs?: number; error?: string })
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
