/**
 * SessionBridge: translate dsh session events into CKP events.
 *
 * dsh 0.1.1-rc.2 real event shapes (verified against dsh-session/dsh-llm types):
 * - user/message   → data: UserMessage { id, role:'user', content: ContentBlock[], source }
 * - assistant/chunk→ data: { turn, step, chunk: StreamChunk }  // text-delta / block-start
 * - assistant/message → data: { turn, step, message: AssistantMessage, usage? }
 * - tool/call      → data: { turn, step, callId, name, arguments: string(JSON) }
 * - tool/result    → data: { turn, step, message: ToolResultMessage }
 * - turn/start     → data: { turn }
 * - turn/end       → data: { turn, reason }
 * - approval/asked/decided → dsh-user-approval audit events (log-only)
 *
 * This bridge maps these → CKP event types and re-emits through the host
 * EventBus (which assigns fresh CKP seqs). Deliberately tolerant: unknown
 * event types are dropped with a debug log — never thrown.
 *
 * @module @dsh-cursorkit/host-dsh/bridge/session-bridge
 */

/** Raw dsh session event (structural subset we care about). */
export interface RawSessionEvent {
  seq?: number;
  type: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** One dsh ContentBlock (text or tool_use variants). */
interface DshContentBlock {
  type?: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  [key: string]: unknown;
}

/** Extract human-readable text from a ContentBlock[]. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      const block = b as DshContentBlock;
      if (typeof block.text === 'string') return block.text;
      if (block.type === 'tool_use' && block.name) {
        try {
          return `[tool:${block.name}] ${typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {})}`;
        } catch {
          return `[tool:${block.name}]`;
        }
      }
      return '';
    })
    .join('');
}

function dataOf(raw: RawSessionEvent): Record<string, unknown> {
  return (raw.data ?? {}) as Record<string, unknown>;
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
  const d = dataOf(raw);
  const message = (d.message ?? d) as { id?: string; role?: string; content?: unknown } | undefined;

  switch (type) {
    case 'user/message': {
      const text = message ? contentToText(message.content) : String(d.text ?? '');
      return { sessionId, type: 'message.user', text, messageId: message?.id ?? raw.seq };
    }

    case 'assistant/chunk': {
      const chunk = d.chunk as { type?: string; text?: string } | undefined;
      const text = chunk?.type === 'text-delta' && typeof chunk.text === 'string' ? chunk.text : '';
      return { sessionId, type: 'message.delta', text };
    }

    case 'assistant/message': {
      const text = message ? contentToText(message.content) : '';
      return {
        sessionId,
        type: 'message.done',
        message: {
          id: message?.id ?? `${sessionId}-${raw.seq ?? Date.now()}`,
          role: 'assistant',
          text,
          createdAt: raw.seq ?? Date.now(),
        },
      };
    }

    case 'tool/call': {
      let args: unknown = d.arguments;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = { raw: args };
        }
      }
      return {
        sessionId,
        type: 'tool.call',
        call: {
          callId: String(d.callId ?? `${sessionId}-${raw.seq ?? Date.now()}`),
          sessionId,
          name: String(d.name ?? 'tool'),
          args,
          status: 'running',
          startedAt: Date.now(),
        },
      };
    }

    case 'tool/result': {
      const block = (message?.content as DshContentBlock[] | undefined)?.[0];
      const callId = String(
        block?.id ??
        (d.message as { callId?: string } | undefined)?.callId ??
        '',
      );
      // ToolResultBlock carries its text in `output`; fall back to contentToText.
      const text = typeof block?.output === 'string' ? block.output : contentToText(message?.content);
      const isError = typeof d.error === 'object' && d.error !== null;
      return {
        sessionId,
        type: isError ? 'tool.done' : 'tool.output',
        callId,
        output: text,
        exitCode: isError ? 1 : 0,
        status: isError ? 'error' : 'success',
      } as RawCkpEvent;
    }

    case 'turn/start':
      // Opening turn — a no-op marker for CKP.
      return { sessionId, type: 'message.delta', text: '' };

    case 'turn/end':
      return null;

    case 'approval/asked':
      return null; // audit-only; ApprovalBridge handles the UI-facing surface

    case 'approval/decided':
      return null;

    default:
      if (/^(error|cancel)/.test(type)) {
        return { sessionId, type: type.includes('cancel') ? 'cancelled' : 'error', message: String(d.text ?? '') };
      }
      // Unknown event type — ignore silently (dsh emits many internal events).
      return null;
  }
}

function messageFromRaw(sessionId: string, raw: RawSessionEvent): {
  id: string;
  role: 'assistant';
  text: string;
  createdAt: number;
} {
  const d = dataOf(raw);
  const text =
    typeof d.text === 'string'
      ? d.text
      : Array.isArray(d.content)
        ? contentToText(d.content)
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

/** Loose CKP event payload as produced by the bridge (seq/ts added by EventBus). */
export interface RawCkpEvent {
  sessionId: string;
  type: string;
  [key: string]: unknown;
}
