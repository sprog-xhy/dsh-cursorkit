/**
 * Multi-session parallel view (M4 T-051): best-of-n runner.
 *
 * Lets the user spawn N parallel sessions with the same prompt, then compare
 * their final assistant messages side by side. Data comes from the CKP
 * client — no extra host surface needed.
 *
 * @module @dsh-cursorkit/features/sessions/parallel
 */

import { useState } from 'react';
import type { CkpClient } from '@dsh-cursorkit/client';
import { useSessionList, useSession } from '../../hooks.ts';
import { Card, Composer } from '@dsh-cursorkit/ui-kit';

export interface ParallelSessionSpec {
  id: string;
  label: string;
  prompt: string;
}

export interface ParallelViewProps {
  client: CkpClient;
}

/**
 * Create n parallel sessions and send the same prompt to each.
 * Returns the created session ids.
 */
export async function spawnParallel(
  client: CkpClient,
  workspace: string,
  prompt: string,
  n: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = await client.sessionCreate(workspace);
    ids.push(s.id);
    // Fire the prompt; errors surface in each session's stream.
    void client.sessionSend(s.id, prompt).catch(() => {});
  }
  return ids;
}

/** Best-of-n comparison: renders each session's last assistant message. */
export function ParallelView({ client }: ParallelViewProps) {
  const [ids, setIds] = useState<string[]>([]);
  const [n, setN] = useState(3);
  const [workspace, setWorkspace] = useState('/tmp/demo');
  const { sessions } = useSessionList(client, 2000);

  const run = async (prompt: string) => {
    const created = await spawnParallel(client, workspace, prompt, n);
    setIds(created);
  };

  return (
    <div style={styles.page}>
      <Card>
        <h3 style={styles.title}>并行会话（best-of-n）</h3>
        <div style={styles.row}>
          <label style={styles.label}>数量</label>
          <input
            type="number"
            min={1}
            max={8}
            value={n}
            onChange={(e) => setN(Number(e.target.value) || 1)}
            style={styles.input}
          />
          <label style={styles.label}>工作区</label>
          <input value={workspace} onChange={(e) => setWorkspace(e.target.value)} style={styles.inputWide} />
        </div>
        <Composer
          onSend={(text) => void run(text)}
          placeholder="输入并行执行的提示词…"
        />
      </Card>

      <div style={styles.grid}>
        {ids.map((id, i) => (
          <SessionResult key={id} client={client} sessionId={id} label={`#${i + 1}`} />
        ))}
      </div>

      {ids.length > 0 && (
        <div style={styles.hint}>
          已创建 {ids.length} 个并行会话（{sessions.filter((s) => ids.includes(s.id)).length} 可见）。每个结果卡显示该会话最后的助手回复。
        </div>
      )}
    </div>
  );
}

function SessionResult({ client, sessionId, label }: { client: CkpClient; sessionId: string; label: string }) {
  const { state } = useSession(client, sessionId);
  const lastAssistant = [...(state?.messages ?? [])].reverse().find((m) => m.role === 'assistant');

  return (
    <Card style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.cardLabel}>{label}</span>
        <span style={styles.cardId}>{sessionId}</span>
        <span style={{ ...styles.statusDot, ...(state?.status === 'running' ? styles.running : {}) }} />
      </div>
      <div style={styles.cardBody}>
        {lastAssistant ? lastAssistant.text : state?.status === 'running' ? '运行中…' : '等待输入…'}
      </div>
    </Card>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 20, overflowY: 'auto', flex: 1 },
  title: { fontSize: 15, fontWeight: 700, margin: '0 0 12px' },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  label: { fontSize: 12.5, color: '#6b7280' },
  input: { width: 60, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5 },
  inputWide: { flex: 1, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 16 },
  card: { minHeight: 120 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardLabel: { fontWeight: 700, fontSize: 13 },
  cardId: { color: '#9ca3af', fontSize: 11, flex: 1 },
  cardBody: { fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap' },
  statusDot: { width: 8, height: 8, borderRadius: '50%', backgroundColor: '#d1d5db' },
  running: { backgroundColor: '#3b82f6' },
  hint: { marginTop: 16, color: '#9ca3af', fontSize: 12.5 },
};
