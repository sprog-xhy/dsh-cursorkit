/**
 * Sessions sidebar: workspace + session list (doc §5).
 *
 * @module @dsh-cursorkit/features/sessions
 */

import { useState } from 'react';
import type { Session } from '@dsh-cursorkit/protocol';
import { SessionList } from '@dsh-cursorkit/ui-kit';

export interface SessionsSidebarProps {
  sessions: Session[];
  loading: boolean;
  activeId?: string;
  onSelect: (id: string) => void;
  onNewSession: (workspace?: string) => Promise<void>;
}

export function SessionsSidebar({ sessions, loading, activeId, onSelect, onNewSession }: SessionsSidebarProps) {
  const [workspace, setWorkspace] = useState('');
  const [creating, setCreating] = useState(false);

  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>
        <span style={styles.title}>dsh-cursorkit</span>
      </div>

      <div style={styles.newRow}>
        <input
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          placeholder="工作区路径"
          style={styles.input}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && workspace.trim()) {
              setCreating(true);
              try {
                await onNewSession(workspace.trim());
                setWorkspace('');
              } finally {
                setCreating(false);
              }
            }
          }}
        />
        <button
          disabled={creating || !workspace.trim()}
          onClick={async () => {
            setCreating(true);
            try {
              await onNewSession(workspace.trim() || undefined);
              setWorkspace('');
            } finally {
              setCreating(false);
            }
          }}
          style={styles.newBtn}
        >
          {creating ? '…' : '新建'}
        </button>
      </div>

      {loading && sessions.length === 0 ? (
        <div style={styles.hint}>加载会话…</div>
      ) : (
        <SessionList
          sessions={sessions}
          activeId={activeId}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: { width: 260, borderRight: '1px solid #e5e7eb', backgroundColor: '#fff', display: 'flex', flexDirection: 'column' },
  header: { padding: '12px 14px', borderBottom: '1px solid #e5e7eb' },
  title: { fontSize: 14, fontWeight: 700, color: '#111827' },
  newRow: { display: 'flex', gap: 6, padding: '10px 12px', borderBottom: '1px solid #f3f4f6' },
  input: { flex: 1, border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 8px', fontSize: 12 },
  newBtn: { border: 'none', borderRadius: 6, padding: '5px 10px', backgroundColor: '#2563eb', color: '#fff', fontSize: 12, cursor: 'pointer' },
  hint: { padding: 16, color: '#9ca3af', fontSize: 12.5 },
};
