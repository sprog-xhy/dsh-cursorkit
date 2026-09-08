/**
 * Derived data selectors (doc §7.3): pure functions over SessionState.
 *
 * @module @dsh-cursorkit/client/store/selectors
 */

import type { SessionState } from './state.ts';

export function getLastMessage(state: SessionState) {
  return state.messages[state.messages.length - 1];
}

export function getRunningToolCalls(state: SessionState): Array<{ callId: string; name: string }> {
  return Object.values(state.toolCalls)
    .filter((t) => t.status === 'pending' || t.status === 'running')
    .map((t) => ({ callId: t.callId, name: t.name }));
}

export function totalToolOutputChars(state: SessionState): number {
  return Object.values(state.toolCalls).reduce((sum, t) => sum + (t.output?.length ?? 0), 0);
}

export function hasPendingApproval(state: SessionState): boolean {
  return state.approvals.length > 0;
}

/** Token usage estimate: total chars across messages (rough proxy until real usage events land). */
export function estimateTokenChars(state: SessionState): { input: number; output: number } {
  const input = state.messages.reduce((s, m) => s + (m.role === 'user' ? m.text.length : 0), 0);
  const output = state.messages.reduce((s, m) => s + (m.role === 'assistant' ? m.text.length : 0), 0);
  return { input, output };
}

/** Count of kept/rejected files (Changes panel summary). */
export function fileChangeSummary(state: SessionState): { kept: number; rejected: number; pending: number } {
  return state.fileChanges.reduce(
    (acc, c) => {
      if (c.status === 'kept') acc.kept++;
      else if (c.status === 'rejected') acc.rejected++;
      else acc.pending++;
      return acc;
    },
    { kept: 0, rejected: 0, pending: 0 },
  );
}
