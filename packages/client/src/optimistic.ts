/**
 * Optimistic UI helpers — ONLY for user messages (doc §7.4). Everything else
 * must follow the event stream.
 *
 * @module @dsh-cursorkit/client/optimistic
 */

import type { LocalMessageEvent } from '@dsh-cursorkit/protocol';

/** Build a local optimistic user message event (seq -1, local: true). */
export function makeLocalMessage(sessionId: string, text: string, localId?: string): LocalMessageEvent {
  return {
    seq: -1,
    ts: Date.now(),
    sessionId,
    type: 'message.user',
    text,
    local: true,
    localId: localId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  };
}

/** Whether an event is a local optimistic event. */
export function isLocalEvent(e: { local?: boolean } | { type: string }): boolean {
  return 'local' in e && e.local === true;
}
