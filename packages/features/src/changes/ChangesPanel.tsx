/**
 * ChangesPanel: M2 diff review — list file changes, keep/reject, open diff.
 *
 * @module @dsh-cursorkit/features/changes
 */

import { useState } from 'react';
import type { SessionState } from '@dsh-cursorkit/client';
import { DiffView, FileChangeList } from '@dsh-cursorkit/ui-kit';

export function ChangesPanel({ state }: { state: SessionState | null }) {
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified');

  if (!state || state.fileChanges.length === 0) {
    return <div style={styles.hint}>尚无文件变更。Agent 修改文件后会出现在这里供审查。</div>;
  }

  const selected = state.fileChanges.find((c) => c.path === selectedPath) ?? state.fileChanges[0];

  return (
    <div style={styles.panel}>
      <FileChangeList
        changes={state.fileChanges}
        onKeep={undefined}
        onReject={undefined}
      />
      {selected && (
        <>
          <div style={styles.diffHeader}>
            <span style={styles.diffTitle}>{selected.path}</span>
            <button style={styles.toggle} onClick={() => setDiffMode(diffMode === 'unified' ? 'split' : 'unified')}>
              {diffMode === 'unified' ? 'split' : 'unified'}
            </button>
          </div>
          <div style={styles.diffBody}>
            <DiffView diff={selected.patch} mode={diffMode} maxLines={400} />
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
  hint: { padding: 16, color: '#9ca3af', fontSize: 12.5 },
  diffHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' },
  diffTitle: { fontSize: 12, fontWeight: 600, fontFamily: 'monospace' },
  toggle: { border: '1px solid #d1d5db', background: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' },
  diffBody: { flex: 1, overflowY: 'auto', padding: 8 },
};
