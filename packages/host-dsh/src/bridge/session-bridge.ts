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

import { inferFileChange } from './file-change.ts';

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
  /** tool-result blocks correlate via this (verified real shape). */
  toolCallId?: string;
  isError?: boolean;
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

/** 透传 dsh 的轮次/步骤标记（供 UI 分组，见 protocol CkpTurnStep）。 */
function turnStepOf(d: Record<string, unknown>): { turn?: number; step?: number } {
  const out: { turn?: number; step?: number } = {};
  if (typeof d.turn === 'number') out.turn = d.turn;
  if (typeof d.step === 'number') out.step = d.step;
  return out;
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
  const message = (d.message ?? d) as
    | { id?: string; role?: string; content?: unknown; source?: { kind?: string } }
    | undefined;

  switch (type) {
    case 'user/message': {
      /**
       * 只把「真实用户消息」渲染成聊天气泡。
       *
       * dsh 会把内部注入也记成 user/message（source.kind = plugin / skill-catalog /
       * compact / tool …）：系统提示快照、技能目录、运行时上下文、工具结果。
       * 原实现不区分 → 聊天里会冒出一堆"用户发的"系统文本（污染会话）。
       */
      const source = (message?.source ?? d.source) as { kind?: string } | undefined;
      const kind = source?.kind;
      if (kind !== undefined && kind !== 'user') return null;
      // 注意：`message` 恒为真（d.message ?? d），所以原先的 `: String(d.text ?? '')`
      // 分支是死代码；这里改为「内容块优先，空则回退到裸 text」。
      const fromContent = message?.content ? contentToText(message.content) : '';
      const text = fromContent || String((d.text ?? '') as string);
      if (!text) return null;
      return { sessionId, type: 'message.user', text, messageId: message?.id ?? raw.seq };
    }

    case 'assistant/chunk': {
      const chunk = d.chunk as { type?: string; text?: string } | undefined;
      // dsh 的真实分片类型：text-delta / reasoning-delta / tool-call-delta / block-* / usage / finish
      // reasoning 片段走 thinking 事件，避免混进正文；其余分片不产生事件
      const isThinking = chunk?.type === 'reasoning-delta';
      const text = typeof chunk?.text === 'string' && (chunk.type === 'text-delta' || isThinking)
        ? chunk.text
        : '';
      if (!text) return null;
      return isThinking
        ? { sessionId, type: 'thinking.delta', text, ...turnStepOf(d) }
        : { sessionId, type: 'message.delta', text, ...turnStepOf(d) };
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
        ...turnStepOf(d),
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
      // dsh ToolResultBlock uses `toolCallId` (not `id`).
      const callId = String(
        block?.toolCallId ??
        block?.id ??
        (d.message as { callId?: string } | undefined)?.callId ??
        '',
      );
      // ToolResultBlock carries its text in `output`; fall back to contentToText.
      const text = typeof block?.output === 'string' ? block.output : contentToText(message?.content);
      const isError = typeof d.error === 'object' && d.error !== null || block?.isError === true;
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

    /**
     * 回合结束。
     *
     * 修复（"点停止没反应"）：原实现直接 `return null`，于是 dsh 的
     * `turn/end {reason:{kind:'aborted'}}` 被丢弃 → 前端收不到任何事件 →
     * busy 永远为 true（一直显示"生成中"、停止按钮不消失）。
     * dsh 的结局有 4 种：completed / aborted / blocked / error。
     */
    case 'session/title': {
      const title = String((d.title ?? d.text ?? '') as string).trim();
      if (!title) return null;
      return { sessionId, type: 'session.title', title };
    }

    case 'turn/end': {
      const reason = (d.reason ?? {}) as {
        kind?: string;
        error?: { message?: string; code?: string };
      };
      const kind = reason.kind ?? 'completed';
      if (kind === 'aborted') {
        return { sessionId, type: 'cancelled', ...turnStepOf(d) };
      }
      if (kind === 'error') {
        return {
          sessionId,
          type: 'error',
          message: reason.error?.message ?? 'turn failed',
          ...turnStepOf(d),
        };
      }
      // completed / blocked（以及未知值）→ 统一收敛为 done
      return { sessionId, type: 'done', status: 'idle', ...turnStepOf(d) };
    }

    case 'approval/asked':
      return null; // audit-only; ApprovalBridge handles the UI-facing surface

    case 'approval/decided':
      return null;

    // dsh 持久化会把连续分片压成一行（text-chunks / reasoning-chunks）；
    // 正常情况下读回时已展开，这里做防御性展开，避免"文字丢失"。
    case 'text-chunks':
    case 'reasoning-chunks': {
      const chunks = (d.chunks ?? []) as { text?: string }[];
      const text = chunks.map((c) => c.text ?? '').join('');
      if (!text) return null;
      return type === 'text-chunks'
        ? { sessionId, type: 'message.delta', text, ...turnStepOf(d) }
        : { sessionId, type: 'thinking.delta', text, ...turnStepOf(d) };
    }

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

/**
 * Stateful tracker bridging tool calls → CKP events.
 *
 * translateRawEvent is a pure single-event mapper; dsh emits tool/call and
 * tool/result as separate events, and file.changed inference needs the call's
 * name/args at result time. This class holds the per-callId context between
 * events and can emit an extra file.changed alongside the tool.done mapping.
 */
export class SessionBridgeTracker {
  private readonly calls = new Map<string, { name: string; args: unknown }>();

  /** Record a tool/call event. Call after translateRawEvent for the same raw. */
  noteCall(raw: RawSessionEvent): void {
    const d = raw.data ?? {};
    const callId = String(d.callId ?? '');
    if (!callId) return;
    let args: unknown = d.arguments ?? d.args;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = { raw: args };
      }
    }
    this.calls.set(callId, { name: String(d.name ?? ''), args });
    // Bound memory: drop old entries when the map grows large.
    if (this.calls.size > 500) {
      const first = this.calls.keys().next().value;
      if (first !== undefined) this.calls.delete(first);
    }
  }

  /**
   * Given a tool/result raw event, return an optional file.changed payload.
   * Call AFTER translateRawEvent for the same raw (which emits tool.output/
   * tool.done); the tracker supplies the write-inference supplement.
   */
  maybeFileChange(sessionId: string, raw: RawSessionEvent): RawCkpEvent | null {
    if (!raw.type?.startsWith('tool/result')) return null;
    const d = raw.data ?? {};
    const block = ((d.message as { content?: DshContentBlock[] } | undefined)?.content)?.[0];
    const callId = String(block?.toolCallId ?? block?.id ?? '');
    const call = callId ? this.calls.get(callId) : undefined;
    if (!call) return null;
    // Consume the entry (a result happens once per call).
    this.calls.delete(callId);
    // Output text comes from the tool-result block's nested text content.
    const output = contentToText(block?.content);
    const change = inferFileChange(
      sessionId,
      call.name,
      call.args,
      output,
    );
    if (!change) return null;
    return {
      sessionId,
      type: 'file.changed',
      change,
    } as RawCkpEvent;
  }
}
