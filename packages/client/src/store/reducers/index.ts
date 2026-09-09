/**
 * Pure root reducer: `state = rootReducer(state, event)`.
 * Every branch is a pure transformation — no side effects, no mutation of
 * inputs (uses structural sharing / spreads).
 *
 * @module @dsh-cursorkit/client/store/reducers
 */

import type { CkpEvent, StoreEvent } from '@dsh-cursorkit/protocol';
import type { Message, ToolCall } from '@dsh-cursorkit/protocol';
import type { SessionState } from '../state.ts';
import { initialState } from '../state.ts';

function mergeMessage(messages: Message[], incoming: Message): Message[] {
  const idx = messages.findIndex((m) => m.id === incoming.id);
  if (idx === -1) return [...messages, incoming];
  const next = [...messages];
  next[idx] = { ...next[idx], ...incoming };
  return next;
}

/** Merge a streaming delta into the last assistant message (or append). */
function appendDelta(messages: Message[], text: string, createdAt: number): Message[] {
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && last.pending) {
    const next = [...messages];
    next[next.length - 1] = { ...last, text: last.text + text, pending: true };
    return next;
  }
  return [
    ...messages,
    {
      // Deterministic id (no RNG) so replay is reproducible.
      id: `pending-${createdAt}`,
      role: 'assistant',
      text,
      pending: true,
      createdAt,
    },
  ];
}

function upsertToolCall(calls: Record<string, ToolCall>, call: ToolCall): Record<string, ToolCall> {
  return { ...calls, [call.callId]: { ...calls[call.callId], ...call } };
}

function removeApproval(approvals: SessionState['approvals'], id: string): SessionState['approvals'] {
  return approvals.filter((a) => a.id !== id);
}

export function rootReducer(state: SessionState, event: CkpEvent | StoreEvent): SessionState {
  // Optimistic local user messages (seq -1): apply immediately, never persist.
  if ('local' in event && event.local === true) {
    return {
      ...state,
      messages: [
        ...state.messages,
        {
          id: event.localId,
          role: 'user',
          text: event.text,
          pending: true,
          createdAt: event.ts,
        },
      ],
      lastSeq: Math.max(state.lastSeq, event.seq),
    };
  }

  const e = event as CkpEvent;
  switch (e.type) {
    case 'session.started': {
      const meta = state.meta ?? {
        id: e.sessionId,
        workspace: e.workspace,
        model: e.model,
        createdAt: e.ts,
        updatedAt: e.ts,
        status: 'running',
      };
      return {
        ...state,
        meta: { ...meta, workspace: e.workspace, model: e.model, status: 'running', updatedAt: e.ts },
        status: 'running',
        lastSeq: e.seq,
      };
    }

    case 'message.user':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `msg-${e.ts}-${e.seq}`,
            role: 'user',
            text: e.text,
            createdAt: e.ts,
          },
        ],
        status: 'running',
        lastSeq: e.seq,
      };

    case 'message.delta':
      return {
        ...state,
        messages: appendDelta(state.messages, e.text, e.ts),
        status: 'running',
        lastSeq: e.seq,
      };

    case 'message.done': {
      // Complete the pending assistant message when it is last, otherwise merge.
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant' && last.pending) {
        const next = [...state.messages];
        next[next.length - 1] = { ...e.message, id: last.id, pending: false };
        return { ...state, messages: next, lastSeq: e.seq };
      }
      return {
        ...state,
        messages: mergeMessage(state.messages, { ...e.message, pending: false }),
        lastSeq: e.seq,
      };
    }

    case 'thinking.delta':
      return {
        ...state,
        thinking: mergeThinking(state.thinking, e.text, e.ts, false),
        status: 'running',
        lastSeq: e.seq,
      };

    case 'thinking.done':
      return {
        ...state,
        thinking: mergeThinking(state.thinking, e.text, e.ts, true),
        lastSeq: e.seq,
      };

    case 'tool.call':
      return {
        ...state,
        toolCalls: upsertToolCall(state.toolCalls, e.call),
        status: 'running',
        lastSeq: e.seq,
      };

    case 'tool.output': {
      const prev = state.toolCalls[e.callId];
      if (!prev) return { ...state, lastSeq: e.seq };
      return {
        ...state,
        toolCalls: upsertToolCall(state.toolCalls, {
          ...prev,
          output: (prev.output ?? '') + e.output,
          exitCode: e.exitCode,
        }),
        lastSeq: e.seq,
      };
    }

    case 'tool.done': {
      const prev = state.toolCalls[e.callId];
      if (!prev) return { ...state, lastSeq: e.seq };
      return {
        ...state,
        toolCalls: upsertToolCall(state.toolCalls, {
          ...prev,
          status: e.status,
          durationMs: e.durationMs,
          error: e.error,
          finishedAt: e.ts,
        }),
        lastSeq: e.seq,
      };
    }

    case 'approval.request':
      return {
        ...state,
        approvals: [...state.approvals, e.approval],
        status: 'awaiting-approval',
        lastSeq: e.seq,
      };

    case 'approval.resolved':
      return {
        ...state,
        approvals: removeApproval(state.approvals, e.approvalId),
        approvalDecisions: { ...state.approvalDecisions, [e.approvalId]: e.decision },
        status: state.approvals.some((a) => a.id !== e.approvalId) ? 'awaiting-approval' : 'running',
        lastSeq: e.seq,
      };

    case 'file.changed':
      return {
        ...state,
        fileChanges: upsertFileChange(state.fileChanges, e.change),
        lastSeq: e.seq,
      };

    case 'checkpoint.created':
      return {
        ...state,
        checkpoints: [...state.checkpoints, e.checkpoint],
        lastSeq: e.seq,
      };

    case 'error':
      return { ...state, status: 'error', lastSeq: e.seq };

    case 'cancelled':
      return { ...state, status: 'cancelled', lastSeq: e.seq };

    case 'done':
      return { ...state, status: e.status ?? 'done', lastSeq: e.seq };

    case 'gap':
      // Gap marker from the transport: keep state, flag for rebuild by caller.
      return { ...state, lastSeq: Math.max(state.lastSeq, e.fromSeq) };

    default:
      return { ...state, lastSeq: Math.max(state.lastSeq, e.seq) };
  }
}

function mergeThinking(
  thinking: SessionState['thinking'],
  text: string,
  ts: number,
  done: boolean,
): SessionState['thinking'] {
  const last = thinking[thinking.length - 1];
  if (last && !last.done) {
    const next = [...thinking];
    next[next.length - 1] = { ...last, text: last.text + text, done: done || last.done };
    return next;
  }
  return [
    ...thinking,
    {
      id: `think-${ts}`,
      sessionId: last?.sessionId ?? '',
      text,
      done,
    },
  ];
}

function upsertFileChange(changes: SessionState['fileChanges'], change: SessionState['fileChanges'][number]) {
  const idx = changes.findIndex((c) => c.path === change.path);
  if (idx === -1) return [...changes, change];
  const next = [...changes];
  next[idx] = change;
  return next;
}

/** Initial state + a pre-reduced event log → final state (pure). */
export function reduceEvents(events: CkpEvent[]): SessionState {
  return events.reduce(rootReducer, initialState());
}
