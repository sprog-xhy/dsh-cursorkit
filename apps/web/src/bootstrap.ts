/**
 * Bootstrap: connect to the dsh sidecar and mount the app.
 *
 * Discovery (doc §3.2): read $DSH_HOME/.cursorkit/runtime.json → build an
 * HttpTransport → CkpClient → bindClient → render <App/>.
 *
 * For the browser shell, DSH_HOME defaults to ~/.dsh but can be overridden
 * via ?dshHome=... or a DSH_HOME global set by the desktop shell.
 *
 * @module web/bootstrap
 */

import { CkpClient, HttpTransport } from '@dsh-cursorkit/client';
import { bindClient } from '@dsh-cursorkit/features';

export interface BootstrapResult {
  client: CkpClient;
  baseUrl: string;
  dshVersion?: string;
  error?: string;
}

const DEFAULT_HOME = `${import.meta.env.VITE_DSH_HOME ?? `${(globalThis as Record<string, unknown>).DSH_HOME ?? '~/.dsh'}`}`;

function expandHome(p: string): string {
  return p.replace(/^~(?=$|\/)/, (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.HOME ?? '');
}

/** Locate runtime.json for a home dir. */
function runtimePath(home: string): string {
  return `${expandHome(home)}/.cursorkit/runtime.json`;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

export async function bootstrap(): Promise<BootstrapResult> {
  const params = new URLSearchParams(location.search);
  const dshHome = params.get('dshHome') ?? DEFAULT_HOME;

  try {
    const rt = (await fetchJson(runtimePath(dshHome))) as {
      port: number;
      token: string;
      dshVersion?: string;
      protocolVersion?: string;
    };
    const baseUrl = `http://127.0.0.1:${rt.port}`;

    // Health check + version negotiation (doc §6.4).
    const health = (await fetchJson(`${baseUrl}/health`)) as { ok: boolean; protocolVersion?: string; dshVersion?: string };
    if (!health.ok) throw new Error('sidecar unhealthy');

    const client = new CkpClient({
      transport: new HttpTransport({ baseUrl, token: rt.token }),
    });
    bindClient(client);

    return { client, baseUrl, dshVersion: health.dshVersion ?? rt.dshVersion };
  } catch (err) {
    return {
      client: undefined as unknown as CkpClient,
      baseUrl: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
