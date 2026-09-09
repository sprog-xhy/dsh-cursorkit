/**
 * Session state shape + root reducer. Reducers MUST be pure functions — this
 * is what makes the store unit-testable and enables time-travel debugging
 * (doc P4 / §7.3).
 *
 * @module @dsh-cursorkit/client/store/state
 */

import type {
  ApprovalDecision,
  ApprovalRequest,
  CkpEvent,
  Checkpoint,
  FileChange,
  Message,
  Session,
  ToolCall,
} from '@dsh-cursorkit/protocol';

export type SessionStatus = 'idle' | 'running' | 'awaiting-approval' | 'done' | 'error' | 'cancelled';

export interface ThinkingBlock {
  id: string;
  sessionId: string;
  text: string;
  done: boolean;
}

export interface SessionState {
  meta: Session | null;
  messages: Message[];
  thinking: ThinkingBlock[];
  toolCalls: Record<string, ToolCall>;
  approvals: ApprovalRequest[];
  approvalDecisions: Record<string, ApprovalDecision>;
  fileChanges: FileChange[];
  checkpoints: Checkpoint[];
  status: SessionStatus;
  /** Last processed event seq. */
  lastSeq: number;
}

export function initialState(): SessionState {
  return {
    meta: null,
    messages: [],
    thinking: [],
    toolCalls: {},
    approvals: [],
    approvalDecisions: {},
    fileChanges: [],
    checkpoints: [],
    status: 'idle',
    lastSeq: 0,
  };
}

export type { CkpEvent };
