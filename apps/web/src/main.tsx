/**
 * App entry for the browser shell.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import { App, ParallelView, SettingsView } from '@dsh-cursorkit/features';
import type { CkpClient } from '@dsh-cursorkit/client';
import { bootstrap } from './bootstrap.ts';

function Shell({ client }: { client: CkpClient }) {
  const [view, setView] = useState<'chat' | 'settings' | 'parallel'>('chat');
  const app = useMemo(() => <App client={client} onNavigate={(v) => setView(v as 'chat' | 'settings' | 'parallel')} />, [client]);
  return (
    <>
      <div style={shellBar}>
        <button onClick={() => setView('chat')} style={view === 'chat' ? barBtnActive : barBtn}>对话</button>
        <button onClick={() => setView('settings')} style={view === 'settings' ? barBtnActive : barBtn}>设置</button>
        <button onClick={() => setView('parallel')} style={view === 'parallel' ? barBtnActive : barBtn}>并行</button>
      </div>
      {view === 'chat' ? app : view === 'settings' ? <SettingsView client={client} /> : <ParallelView client={client} />}
    </>
  );
}

const shellBar: React.CSSProperties = { display: 'flex', gap: 4, padding: '6px 10px', background: '#111827', position: 'sticky', top: 0, zIndex: 10 };
const barBtn: React.CSSProperties = { border: 'none', background: 'none', color: '#9ca3af', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5 };
const barBtnActive: React.CSSProperties = { ...barBtn, background: '#374151', color: '#fff' };

async function main() {
  const result = await bootstrap();

  const root = createRoot(document.getElementById('root')!);

  if (result.error) {
    root.render(
      <div style={{ fontFamily: 'system-ui', padding: 40, maxWidth: 560 }}>
        <h2 style={{ color: '#b91c1c' }}>无法连接 dsh sidecar</h2>
        <p>{result.error}</p>
        <p style={{ color: '#6b7280', fontSize: 13 }}>
          请先启动 sidecar：<code>DSH_HOME=… dsh --profile cursorkit</code>
          （见 <code>scripts/profile-template/README.md</code>），并确认
          <code>$DSH_HOME/.cursorkit/runtime.json</code> 存在。
        </p>
      </div>,
    );
    return;
  }

  root.render(
    <StrictMode>
      <Shell client={result.client} />
    </StrictMode>,
  );
}

void main();
