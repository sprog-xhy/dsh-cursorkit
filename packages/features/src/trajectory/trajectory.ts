/**
 * Trajectory helpers: build the source-grouped event view (M2 T-035).
 * Pure functions — testable without React.
 *
 * @module @dsh-cursorkit/features/trajectory
 */

import type { SessionState } from '@dsh-cursorkit/client';

export interface TrajectoryItem {
  id: string;
  source: string;
  title: string;
  payload?: unknown;
  ts: number;
}

/** Build trajectory items from session state, grouped by source in time order. */
export function buildTrajectory(state: SessionState | null): TrajectoryItem[] {
  if (!state) return [];
  const items: TrajectoryItem[] = [];

  for (const m of state.messages) {
    if (m.role === 'user') {
      items.push({ id: `msg-${m.id}`, source: '用户输入', title: m.text.slice(0, 80), ts: m.createdAt });
    } else if (m.role === 'assistant') {
      items.push({ id: `msg-${m.id}`, source: '模型回复', title: m.text.slice(0, 80), ts: m.createdAt });
    }
  }
  for (const t of state.thinking) {
    items.push({ id: `think-${t.id}`, source: '思维链', title: t.text.slice(0, 80), ts: Date.now() });
  }
  for (const tc of Object.values(state.toolCalls)) {
    items.push({
      id: `tool-${tc.callId}`,
      source: '工具调用',
      title: `${tc.name} (${tc.status})`,
      payload: tc,
      ts: tc.startedAt ?? Date.now(),
    });
  }
  return items.sort((a, b) => a.ts - b.ts);
}

/** Group items by source, preserving relative order. */
export function groupBySource(items: TrajectoryItem[]): Array<{ source: string; items: TrajectoryItem[] }> {
  const groups = new Map<string, TrajectoryItem[]>();
  for (const item of items) {
    const list = groups.get(item.source) ?? [];
    list.push(item);
    groups.set(item.source, list);
  }
  return [...groups.entries()].map(([source, its]) => ({ source, items: its }));
}
