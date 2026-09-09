/**
 * Auto-checkpoint hook (M2 T-033 自动生成补全).
 *
 * When the bridge infers a file.changed (a write tool ran), the host can
 * automatically create a git checkpoint so the user can restore to
 * "before this write". This is the "每次写入前生成 checkpoint" behavior
 * from doc §M2-3, implemented as a hook the plugin wires into the bus.
 *
 * Pure computation over EventBus events — no ctx access (doc P3); the
 * checkpoint create call goes through the checkpoint provider.
 *
 * @module @dsh-cursorkit/host-dsh/checkpoint/auto-checkpoint
 */

import type { CkpEvent } from '@dsh-cursorkit/protocol';
import type { EventBus } from '../rpc/sse.ts';
import { createCheckpoint, type CheckpointOptions } from './git-checkpoint.ts';

export interface AutoCheckpointOptions {
  /** Min interval between auto checkpoints per session (ms). */
  throttleMs?: number;
  /** When false, only manual checkpoints (no auto). */
  enabled?: boolean;
}

interface AutoCheckpointState {
  lastAt: number;
}

/**
 * Wire the hook onto an EventBus. Call once at plugin start; returns a
 * disposer. For every file.changed on the bus, creates a checkpoint in the
 * session's workspace (throttled).
 */
export function attachAutoCheckpoint(
  bus: EventBus,
  resolveWorkspace: (sessionId: string) => string | undefined,
  opts: AutoCheckpointOptions = {},
): () => void {
  const { throttleMs = 60_000, enabled = true } = opts;
  const state = new Map<string, AutoCheckpointState>();

  if (!enabled) return () => {};

  const onEvent = (e: CkpEvent) => {
    if (e.type !== 'file.changed') return;
    const sessionId = e.sessionId;
    const now = Date.now();
    const prev = state.get(sessionId);
    if (prev && now - prev.lastAt < throttleMs) return; // throttled

    const workspace = resolveWorkspace(sessionId);
    if (!workspace) return;

    state.set(sessionId, { lastAt: now });
    const optsForCheckpoint: CheckpointOptions = { cwd: workspace, sessionId };
    void createCheckpoint(optsForCheckpoint, `auto: ${e.change.path}`).then((cp) => {
      if (cp) {
        bus.emit({
          sessionId,
          type: 'checkpoint.created',
          checkpoint: cp,
        } as never);
      }
    });
  };

  bus.subscribe({ onEvent });
  return () => {
    // Bus subscriptions are managed by the bus; the disposer is a no-op here
    // because we rely on bus.close() at teardown. Kept for API symmetry.
  };
}
