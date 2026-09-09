/**
 * App shell: three-column layout (Sidebar | Main | Right Rail).
 * doc GOAL §5 前端信息架构.
 *
 * @module @dsh-cursorkit/features/App
 */

import { useMemo, useState } from 'react';
import type { CkpClient } from '@dsh-cursorkit/client';
import { useSession, useSessionList } from './hooks.ts';
import { ChatView } from './chat/ChatView.tsx';
import { SessionsSidebar } from './sessions/SessionsSidebar.tsx';
import { StatusBar } from '@dsh-cursorkit/ui-kit';
import { TrajectoryPanel } from '@dsh-cursorkit/ui-kit';
import { ChangesPanel } from './changes/ChangesPanel.tsx';
import { CheckpointsPanel } from './checkpoints/CheckpointsPanel.tsx';

export type RailTab = 'trajectory' | 'changes' | 'checkpoints';

export interface AppProps {
  client: CkpClient;
}

export function App({ client }: AppProps) {
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [railTab, setRailTab] = useState<RailTab>('trajectory');
  const { sessions, loading } = useSessionList(client);
  const session = useSession(client, activeSessionId);

  // Pick the first session when none selected.
  const effectiveSessionId = activeSessionId ?? sessions[0]?.id;

  const activeSession = useMemo(
    () => (effectiveSessionId ? sessionStoreFor(client, effectiveSessionId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, effectiveSessionId],
  );
  void activeSession;

  return (
    <div style={styles.shell}>
      <div style={styles.columns}>
        <SessionsSidebar
          sessions={sessions}
          loading={loading}
          activeId={effectiveSessionId}
          onSelect={setActiveSessionId}
          onNewSession={async (workspace) => {
            const s = await client.sessionCreate(workspace ?? '/tmp/demo');
            setActiveSessionId(s.id);
          }}
        />
        <ChatView client={client} sessionId={effectiveSessionId} />
        <div style={styles.rail}>
          <RailHeader tab={railTab} onTab={setRailTab} />
          {railTab === 'trajectory' && <TrajectoryPanel items={trajectoryItems(session.state)} />}
          {railTab === 'changes' && <ChangesPanel state={session.state} />}
          {railTab === 'checkpoints' && <CheckpointsPanel state={session.state} />}
        </div>
      </div>
      <StatusBar
        connected={true}
        dshVersion={undefined}
        model={session.state?.meta?.model}
        tokenCount={undefined}
        elapsedMs={undefined}
      />
    </div>
  );
}

/** Bridge helper so App can grab a store for a session id without a hook. */
function sessionStoreFor(client: CkpClient, sessionId: string) {
  return client.storeFor(sessionId);
}

function RailHeader({ tab, onTab }: { tab: RailTab; onTab: (t: RailTab) => void }) {
  return (
    <div style={styles.railHeader}>
      {(['trajectory', 'changes', 'checkpoints'] as const).map((t) => (
        <button
          key={t}
          onClick={() => onTab(t)}
          style={{ ...styles.railTab, ...(tab === t ? styles.railTabActive : {}) }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function trajectoryItems(state: ReturnType<typeof useSession>['state']) {
  if (!state) return [];
  const items: Array<{ id: string; source: string; title: string; payload?: unknown; ts: number }> = [];
  for (const m of state.messages) {
    if (m.role === 'user') items.push({ id: `msg-${m.id}`, source: '用户输入', title: m.text.slice(0, 60), ts: m.createdAt });
    if (m.role === 'assistant') items.push({ id: `msg-${m.id}`, source: '模型回复', title: m.text.slice(0, 60), ts: m.createdAt });
  }
  for (const t of state.thinking) items.push({ id: `think-${t.id}`, source: '思维链', title: t.text.slice(0, 60), ts: Date.now() });
  for (const tc of Object.values(state.toolCalls)) {
    items.push({ id: `tool-${tc.callId}`, source: '工具调用', title: `${tc.name} (${tc.status})`, payload: tc, ts: tc.startedAt ?? Date.now() });
  }
  return items.sort((a, b) => a.ts - b.ts);
}

const styles: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#fafaf9' },
  columns: { display: 'flex', flex: 1, minHeight: 0 },
  rail: { width: 320, borderLeft: '1px solid #e5e7eb', backgroundColor: '#fff', display: 'flex', flexDirection: 'column', overflowY: 'auto' },
  railHeader: { display: 'flex', borderBottom: '1px solid #e5e7eb', padding: '6px 8px', gap: 4 },
  railTab: { border: 'none', background: 'none', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, color: '#6b7280' },
  railTabActive: { backgroundColor: '#f3f4f6', color: '#111827', fontWeight: 600 },
};
