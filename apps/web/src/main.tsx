/**
 * App entry for the browser shell.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@dsh-cursorkit/features';
import { bootstrap } from './bootstrap.ts';

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
      <App client={result.client} />
    </StrictMode>,
  );
}

void main();
