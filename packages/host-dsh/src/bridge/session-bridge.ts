/**
 * SessionBridge: translate dsh session events into CKP events.
 *
 * dsh 0.1.1-rc.2 real API (see docs/dsh-capability-audit.md §3):
 * - Subscribe: `ctx.on('session/event', (session, event) => …)`
 * - Events carry their own seq (session.log length contract)
 * - SessionEvent types: user/…, assistant/…, tool/…, turn/start, request/header…
 *
 * This bridge maps dsh event types → CKP event types and re-emits through the
 * host EventBus (which assigns fresh CKP seqs). It is deliberately tolerant:
 * unknown dsh event types are passed through as a generic `message.delta`-ish
 * or dropped with a debug log — never thrown.
 *
 * @module @dsh-cursorkit/host-dsh/bridge/session-bridge
 */

import type { CkpEvent } from '@dsh-cursorkit/protocol';
import type { EventBus } from '../rpc/sse.ts';

/** Loose CKP event payload as produced by the bridge (seq/ts added by EventBus). */
export interface RawCkpEvent {
  sessionId: string;
  type: string;
  [key: string]: unknown;
}

/** Raw dsh session event (structural subset we care about). */
export interface RawSessionEvent {
  seq?: number;
  type: string;
  data?: {
    text?: string;
    content?: string | unknown[];
    message?: unknown;
    toolName?: string;
    toolCallId?: string;
    args?: unknown;
    output?: string;
    exitCode?: number;
    name?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** A dsh session object we subscribe to. */
export interface BridgeSession {
  id: string;
  seq?: number;
  events?: readonly RawSessionEvent[];
  deriveMessages?: () => unknown[];
}

export interface SessionBridgeOptions {
  bus: EventBus;
  /** Optional session-scoped filter: only translate events for these ids. */
  sessionFilter?: (sessionId: string) => boolean;
  onError?: (err: unknown) => void;
}

/**
 * Translate one raw dsh event into a CKP event payload (without seq/ts —
 * EventBus assigns them). Returns null when the event maps to nothing.
 */
export function translateRawEvent(
  sessionId: string,
  raw: RawSessionEvent,
): RawCkpEvent | null {
  const type = raw.type ?? '';
  const d = raw.data ?? {};

  if (type.startsWith('user/')) {
    return { sessionId, type: 'message.user', text: typeof d.text === 'string' ? d.text : '' };
  }
  if (type.startsWith('assistant/chunk')) {
    return {
      sessionId,
      type: 'message.delta',
      text: typeof d.text === 'string' ? d.text : typeof d.content === 'string' ? d.content : '',
    };
  }
  if (type.startsWith('assistant/') || type === 'assistant') {
    return { sessionId, type: 'message.done', message: messageFromRaw(sessionId, raw) };
  }
  if (type.startsWith('tool/') && type.includes('call')) {
    return {
      sessionId,
      type: 'tool.call',
      call: {
        callId: String(d.toolCallId ?? `${sessionId}-${raw.seq ?? Date.now()}`),
        sessionId,
        name: String(d.toolName ?? d.name ?? 'tool'),
        args: d.args,
        status: 'running',
        startedAt: Date.now(),
      },
    };
  }
  if (type.startsWith('tool/') && (type.includes('output') || type.includes('result'))) {
    return {
      sessionId,
      type: 'tool.output',
      callId: String(d.toolCallId ?? ''),
      output: typeof d.output === 'string' ? d.output : typeof d.text === 'string' ? d.text : '',
      exitCode: typeof d.exitCode === 'number' ? d.exitCode : undefined,
    };
  }
  if (type.startsWith('tool/') && (type.includes('done') || type.includes('end'))) {
    return {
      sessionId,
      type: 'tool.done',
      callId: String(d.toolCallId ?? ''),
      status: typeof d.exitCode === 'number' && d.exitCode !== 0 ? 'error' : 'success',
      durationMs: undefined,
      error: undefined,
    };
  }
  if (type === 'turn/start') {
    return { sessionId, type: 'message.delta', text: '' };
  }
  if (type === 'done' || type === 'session/done') {
    return { sessionId, type: 'done', status: 'done' };
  }
  if (type === 'error' || type === 'session/error') {
    return { sessionId, type: 'error', message: typeof d.text === 'string' ? d.text : String(raw.error ?? '') };
  }
  if (type === 'cancel' || type === 'session/cancel' || type === 'cancelled') {
    return { sessionId, type: 'cancelled' };
  }
  // Unknown event type — ignore silently (dsh emits many internal events).
  return null;
}

function messageFromRaw(sessionId: string, raw: RawSessionEvent): {
  id: string;
  role: 'assistant';
  text: string;
  createdAt: number;
} {
  const d = raw.data ?? {};
  const text =
    typeof d.text === 'string'
      ? d.text
      : Array.isArray(d.content)
        ? d.content
            .map((c) => (typeof c === 'object' && c !== null && 'text' in c ? String((c as { text: unknown }).text) : ''))
            .join('')
        : typeof d.content === 'string'
          ? d.content
          : '';
  return {
    id: `${sessionId}-${raw.seq ?? Date.now()}`,
    role: 'assistant',
    text,
    createdAt: Date.now(),
  };
}
