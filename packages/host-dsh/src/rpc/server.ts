/**
 * HTTP+SSE server exposing the CKP protocol on 127.0.0.1.
 *
 * Routes:
 *   GET  /health                    → 200 { ok, uptime, dshVersion, protocolVersion }
 *   GET  /v1/capabilities           → CapabilityReport
 *   POST /v1/rpc/:method            → unified RPC entry (body: { params })
 *   GET  /v1/sessions/:id/events?from=N → SSE
 *   GET  /v1/ui-contrib             → UI contribution manifest (empty for now)
 *   POST /shutdown                  → graceful exit
 *
 * /v1/* requires `Authorization: Bearer <token>`; /health is unauthenticated.
 *
 * @module @dsh-cursorkit/host-dsh/rpc/server
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  CkpMethodName,
  CkpEvent,
  Request as CkpRequest,
  Response as CkpResponse,
} from '@dsh-cursorkit/protocol';
import { isCkpMethod } from '@dsh-cursorkit/protocol';
import { CkpError } from '@dsh-cursorkit/protocol';
import { CKP_PROTOCOL_VERSION } from '@dsh-cursorkit/protocol';
import type { CapabilityReport } from '../capability.ts';
import { Router } from './router.ts';
import { EventBus } from './sse.ts';
import { extractBearer, tokenMatches } from './auth.ts';
import { httpStatusForCode, HttpError } from './errors.ts';
import type { ApprovalBridge } from '../bridge/approval-bridge.ts';
import type { SessionStoreView, AgentView } from '../compat/sessions.ts';

export interface ServerDeps {
  token: string;
  capabilities: CapabilityReport;
  bus: EventBus;
  approvals: ApprovalBridge;
  sessions: SessionStoreView;
  agent: AgentView;
  /** Return the app version string. */
  appVersion: string;
}

export interface ServerHandle {
  port: number;
  /** Stop accepting connections and close the server. */
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(raw),
  });
  res.end(raw);
}

function sendSse(res: ServerResponse, event: CkpEvent | { event: string; data: unknown }): void {
  const data = JSON.stringify(event);
  res.write(`data: ${data}\n\n`);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw.length === 0 ? {} : JSON.parse(raw));
      } catch (err) {
        reject(new HttpError(400, `invalid JSON body: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
    req.on('error', reject);
  });
}

export function startServer(deps: ServerDeps): Promise<ServerHandle> {
  const { token, capabilities, bus, approvals, sessions, agent } = deps;
  const router = new Router({ sessions, agent, approvals, bus, capabilities, dshVersion: deps.appVersion });
  const startedAt = Date.now();

  const server: Server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { ok: false, error: { code: 'TRANSPORT_ERROR', message: err.message } });
      } else if (err instanceof CkpError) {
        sendJson(res, httpStatusForCode(err.code), { ok: false, error: err.toJSON() });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message } });
      }
    }
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    // /health — unauthenticated
    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, {
        ok: true,
        uptime: Date.now() - startedAt,
        dshVersion: capabilities.dshVersion,
        dshCommit: capabilities.dshCommit,
        protocolVersion: CKP_PROTOCOL_VERSION,
      });
      return;
    }

    // /shutdown — unauthenticated (loopback only; used by the sidecar manager)
    if (req.method === 'POST' && path === '/shutdown') {
      sendJson(res, 200, { ok: true });
      setTimeout(() => {
        void server.close();
        // Give the host a moment to flush, then hard-exit.
        setTimeout(() => process.exit(0), 100);
      }, 50);
      return;
    }

    // Everything else under /v1/* requires auth
    if (!path.startsWith('/v1/')) {
      throw new HttpError(404, `not found: ${path}`);
    }
    const auth = extractBearer(req.headers.authorization);
    if (!tokenMatches(auth, token)) {
      throw new HttpError(401, 'unauthorized: missing or invalid bearer token');
    }

    // GET /v1/capabilities
    if (req.method === 'GET' && path === '/v1/capabilities') {
      sendJson(res, 200, capabilities);
      return;
    }

    // GET /v1/ui-contrib
    if (req.method === 'GET' && path === '/v1/ui-contrib') {
      sendJson(res, 200, { panels: [], renderers: [], settings: [], commands: [], status: [] });
      return;
    }

    // GET /v1/sessions/:id/events?from=N  → SSE
    const eventsMatch = /^\/v1\/sessions\/([^/]+)\/events$/.exec(path);
    if (req.method === 'GET' && eventsMatch) {
      const sessionId = decodeURIComponent(eventsMatch[1] ?? '');
      const from = Number(url.searchParams.get('from') ?? 0);
      void sessionId;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      // Send initial replay window.
      const replay = bus.replayFrom(from);
      if (replay === null) {
        // Ring buffer gap: tell the client to rebuild.
        sendSse(res, { event: 'gap', data: { fromSeq: from, lastSeq: bus.lastSeq } });
      } else {
        for (const e of replay) sendSse(res, e);
      }
      // Subscribe for live events.
      const dispose = bus.subscribe({ onEvent: (e) => sendSse(res, e), onClose: () => res.end() });
      req.on('close', () => {
        dispose();
        res.end();
      });
      return;
    }

    // POST /v1/rpc/:method
    const rpcMatch = /^\/v1\/rpc\/([^/]+)$/.exec(path);
    if (req.method === 'POST' && rpcMatch) {
      const method = decodeURIComponent(rpcMatch[1] ?? '');
      const body = (await readBody(req)) as Partial<CkpRequest>;
      const reqId = typeof body.id === 'string' ? body.id : `req-${Date.now()}`;
      if (!isCkpMethod(method)) {
        sendJson(res, 400, {
          id: reqId,
          ok: false,
          error: { code: 'INTERNAL', message: `unknown method: ${method}` },
        } satisfies CkpResponse);
        return;
      }
      try {
        const result = await router.dispatch(method as CkpMethodName, body.params as never);
        sendJson(res, 200, { id: reqId, ok: true, result } satisfies CkpResponse);
      } catch (err) {
        const ckp = err instanceof CkpError ? err : CkpError.from(err);
        sendJson(res, httpStatusForCode(ckp.code), { id: reqId, ok: false, error: ckp.toJSON() } satisfies CkpResponse);
      }
      return;
    }

    throw new HttpError(404, `not found: ${req.method} ${path}`);
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((e) => (e ? rej(e) : res()));
          }),
      });
    });
  });
}
