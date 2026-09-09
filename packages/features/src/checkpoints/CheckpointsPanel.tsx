/**
 * CheckpointsPanel: M2 checkpoint timeline (doc §M2-3).
 *
 * @module @dsh-cursorkit/features/checkpoints
 */

import type { SessionState } from '@dsh-cursorkit/client';
import { CheckpointTimeline } from '@dsh-cursorkit/ui-kit';

export function CheckpointsPanel({ state }: { state: SessionState | null }) {
  if (!state || state.checkpoints.length === 0) {
    return <div style={styles.hint}>暂无 checkpoint。每次写入前生成，可点恢复（生成新 fork，不覆盖历史）。</div>;
  }
  return (
    <div style={styles.panel}>
      <CheckpointTimeline
        checkpoints={state.checkpoints}
        onPreview={undefined}
        onRestore={undefined}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { padding: 12 },
  hint: { padding: 16, color: '#9ca3af', fontSize: 12.5 },
};
