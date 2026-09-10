import { describe, expect, it } from 'vitest';
import { startServer } from '../src/rpc/server.ts';
import { EventBus } from '../src/rpc/sse.ts';
import { ApprovalBridge } from '../src/bridge/approval-bridge.ts';
import type { CapabilityReport } from '../src/capability.ts';
import type { SessionStoreView, AgentRegistryView } from '../src/compat/sessions.ts';

function makeReport(overrides?: Partial<CapabilityReport>): CapabilityReport {
  return {
    dshVersion: '0.1.1-rc.2',
    required: { ok: true, missing: [] },
    optional: {
      'sessions.fork': true,
      'sessions.cancel': true,
      'approvals.request': true,
      'approvals.resolve': true,
      'tools.list': true,
      'skills.list': true,
      'plugins.list': true,
      'mcp.list': true,
      'mcp.add': true,
      'mcp.remove': true,
      'models.list': true,
      'models.select': true,
      'jobs.schedule': true,
    },
    probedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSessions(): SessionStoreView & { seeds: { id: string; seq: number }[] } {
  const seeds: { id: string; seq: number }[] = [];
  return {
    seeds,
    create: () => {
      const id = `session-${seeds.length + 1}`;
      seeds.push({ id, seq: 0 });
      return { id, header: { cwd: '/tmp', createdAt: Date.now() }, seq: 0 };
    },
    get: (id: string) => {
      const s = seeds.find((x) => x.id === id);
      return s ? { id: s.id, header: { cwd: '/tmp', createdAt: Date.now() }, seq: s.seq } : undefined;
    },
    list: () => seeds.map((s) => ({ id: s.id, header: { cwd: '/tmp', createdAt: Date.now() }, seq: s.seq })),
    fork: (source: unknown, boundary?: number) => {
      const sid = typeof source === 'string' ? source : (source as { id: string }).id;
      const child = { id: `${sid}-fork`, header: { cwd: '/tmp', createdAt: Date.now() }, seq: boundary ?? 0 };
      seeds.push({ id: child.id, seq: child.seq });
      return child;
    },
    flush: async () => true,
  };
}

const createdIds: string[] = [];
const agentRegistry: AgentRegistryView = {
  get: () => ({ send: () => {}, cancel: async () => {}, inbox: { append: () => {} } }),
  list: () => [],
  create: async (opts: { sessionId: string }) => {
    // session.create 现在通过 agents.create 动态创建 session+agent；
    // mock 记录 id（session 存储由 sessions mock 提供）。
    createdIds.push(opts.sessionId);
    return { agent: { id: opts.sessionId } };
  },
};

describe('HTTP+SSE server', () => {
  it('serves health, capabilities, RPC, and SSE end to end', async () => {
    const token = 'test-token-0123456789abcdef';
    const bus = new EventBus();
    const approvals = new ApprovalBridge({ bus });
    const sessions = makeSessions();
    const capabilities = makeReport();

    const server = await startServer({
      token,
      capabilities,
      bus,
      approvals,
      sessions,
      agents: agentRegistry,
      appVersion: '0.1.1-rc.2',
    });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      // health (unauthenticated)
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      const healthJson = (await health.json()) as { ok: boolean; protocolVersion: string };
      expect(healthJson.ok).toBe(true);
      expect(healthJson.protocolVersion).toBe('ckp/1');

      // /v1 without token → 401
      const noAuth = await fetch(`${base}/v1/capabilities`);
      expect(noAuth.status).toBe(401);

      // capabilities with token
      const caps = await fetch(`${base}/v1/capabilities`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(caps.status).toBe(200);
      expect(((await caps.json()) as { dshVersion: string }).dshVersion).toBe('0.1.1-rc.2');

      // RPC: session.create → session.list
      const createRes = await fetch(`${base}/v1/rpc/session.create`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'r1', method: 'session.create', params: { workspace: '/tmp' } }),
      });
      expect(createRes.status).toBe(200);
      const created = (await createRes.json()) as { ok: true; result: { id: string } };
      expect(created.ok).toBe(true);
      expect(created.result.id).toMatch(/^session-/);
      expect(createdIds).toContain(created.result.id);

      const listRes = await fetch(`${base}/v1/rpc/session.list`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'r2', method: 'session.list', params: {} }),
      });
      const listed = (await listRes.json()) as { result: unknown[] };
      expect(Array.isArray(listed.result)).toBe(true);

      // SSE subscribe: connect, then emit an event via bus, expect it on the wire
      const ssePromise = (async () => {
        const ctrl = new AbortController();
        const resp = await fetch(`${base}/v1/sessions/session-1/events?from=0`, {
          headers: { authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        expect(resp.status).toBe(200);
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          if (buf.includes('message.user')) break;
        }
        ctrl.abort();
        return buf;
      })();

      // give the SSE connection a moment to establish, then emit
      await new Promise((r) => setTimeout(r, 100));
      bus.emit({ sessionId: 'session-1', type: 'message.user', text: 'ping from bus' });
      const sseData = await ssePromise;
      expect(sseData).toContain('ping from bus');

      // unknown method → 400
      const bad = await fetch(`${base}/v1/rpc/nope.nope`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'r3', method: 'nope.nope', params: {} }),
      });
      expect(bad.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it('returns 404 for unknown /v1 paths with token', async () => {
    const token = 't2';
    const bus = new EventBus();
    const server = await startServer({
      token,
      capabilities: makeReport(),
      bus,
      approvals: new ApprovalBridge({ bus }),
      sessions: makeSessions(),
      agents: agentRegistry,
      appVersion: 'x',
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/does-not-exist`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
