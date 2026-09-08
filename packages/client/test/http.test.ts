import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { HttpTransport } from '../src/transport/http.ts';

/** Minimal CKP host server for transport tests. */
function startFakeHost(): Promise<{ server: Server; baseUrl: string; events: unknown[]; token: string }> {
  const token = 'tok-test';
  const events: unknown[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'no' } }));
        return;
      }
      if (req.method === 'POST' && /^\/v1\/rpc\//.test(path)) {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body) as { id: string; method: string; params: { echo?: string } };
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: parsed.id, ok: true, result: { echo: parsed.params?.echo ?? parsed.method } }));
        });
        return;
      }
      const m = /^\/v1\/sessions\/([^/]+)\/events/.exec(path);
      if (req.method === 'GET' && m) {
        const from = Number(url.searchParams.get('from') ?? 0);
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          connection: 'keep-alive',
        });
        // replay window
        for (const e of events) {
          const ev = e as { seq: number };
          if (ev.seq > from) res.write(`data: ${JSON.stringify(e)}\n\n`);
        }
        // live: push 2 events
        const e1 = { seq: 101, ts: Date.now(), sessionId: m[1], type: 'message.user', text: 'live-1' };
        const e2 = { seq: 102, ts: Date.now(), sessionId: m[1], type: 'message.delta', text: 'live-2' };
        events.push(e1, e2);
        res.write(`data: ${JSON.stringify(e1)}\n\n`);
        res.write(`data: ${JSON.stringify(e2)}\n\n`);
        setTimeout(() => res.end(), 50);
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: 'nf' } }));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}`, events, token });
    });
  });
}

describe('HttpTransport', () => {
  it('calls RPC and unwraps the result envelope', async () => {
    const { server, baseUrl, token } = await startFakeHost();
    try {
      const t = new HttpTransport({ baseUrl, token });
      const result = await t.call('session.send', { echo: 'hi' });
      expect(result).toEqual({ echo: 'hi' });
    } finally {
      server.close();
    }
  });

  it('rejects with CkpError on 401', async () => {
    const { server, baseUrl } = await startFakeHost();
    try {
      const t = new HttpTransport({ baseUrl, token: 'wrong' });
      await expect(t.call('session.list', {})).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    } finally {
      server.close();
    }
  });

  it('subscribes to SSE, receives replay + live events with seq resume', async () => {
    const { server, baseUrl, token } = await startFakeHost();
    try {
      const t = new HttpTransport({ baseUrl, token });
      const seen: number[] = [];
      await new Promise<void>((resolve) => {
        const dispose = t.subscribe('s1', {
          fromSeq: 0,
          onEvent: (e) => {
            seen.push(e.seq);
            if (e.seq >= 102) {
              dispose();
              resolve();
            }
          },
          onClose: () => resolve(),
        });
        // safety timeout
        setTimeout(() => {
          dispose();
          resolve();
        }, 3000);
      });
      expect(seen).toContain(101);
      expect(seen).toContain(102);
    } finally {
      server.close();
    }
  });
});
