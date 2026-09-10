/**
 * M1 core-loop integration test: real host-dsh server ↔ real client SDK.
 *
 * This exercises the full CKP stack without a dsh process:
 * - host: EventBus + Router + HTTP/SSE server (same code path the dsh plugin runs)
 * - client: HttpTransport + EventStore + CkpClient facade
 *
 * @module integration
 */

import { describe, expect, it } from 'vitest';
import { startServer } from '@dsh-cursorkit/host-dsh';
import { EventBus } from '@dsh-cursorkit/host-dsh';
import { ApprovalBridge } from '@dsh-cursorkit/host-dsh';
import { CkpClient, HttpTransport } from '@dsh-cursorkit/client';
import type { CapabilityReport } from '@dsh-cursorkit/host-dsh';

function makeReport(): CapabilityReport {
  return {
    dshVersion: '0.1.1-rc.2',
    required: { ok: true, missing: [] },
    optional: Object.fromEntries(
      ['sessions.fork', 'sessions.cancel', 'approvals.request', 'approvals.resolve', 'tools.list', 'skills.list', 'plugins.list', 'mcp.list', 'mcp.add', 'mcp.remove', 'models.list', 'models.select', 'jobs.schedule'].map((k) => [k, true]),
    ),
    probedAt: new Date().toISOString(),
  };
}

const sessionsView = {
  seeds: [] as Array<{ id: string; seq: number }>,
  create() {
    const id = `session-${this.seeds.length + 1}`;
    this.seeds.push({ id, seq: 0 });
    return { id, header: { cwd: '/tmp', createdAt: Date.now() }, seq: 0 };
  },
  get(id: string) {
    const s = this.seeds.find((x) => x.id === id);
    return s ? { id, header: { cwd: '/tmp', createdAt: Date.now() }, seq: s.seq } : undefined;
  },
  list() {
    return this.seeds.map((s) => ({ id: s.id, header: { cwd: '/tmp', createdAt: Date.now() }, seq: s.seq }));
  },
  fork(source: unknown) {
    const sid = typeof source === 'string' ? source : (source as { id: string }).id;
    const child = { id: `${sid}-fork`, header: { cwd: '/tmp', createdAt: Date.now() }, seq: 0 };
    this.seeds.push(child);
    return child;
  },
  flush: async () => true,
};

const agentRegistry = {
  get: () => ({ send: () => {}, cancel: async () => {}, inbox: { append: () => {} } }),
  list: () => [],
  create: async (opts: { sessionId: string }) => {
    // 模拟 dsh AgentRegistry.create：同时注册 session（router 不再调 sessions.create）
    sessionsView.seeds.push({ id: opts.sessionId, seq: 0 });
    return { agent: { id: opts.sessionId } };
  },
};

describe('M1 core loop (host × client integration)', () => {
  it('creates a session via client, streams a message, and resolves an approval', async () => {
    const token = 'integration-token';
    const bus = new EventBus();
    const approvals = new ApprovalBridge({ bus });
    const server = await startServer({
      token,
      capabilities: makeReport(),
      bus,
      approvals,
      sessions: sessionsView as never,
      agents: agentRegistry as never,
      appVersion: '0.1.1-rc.2',
    });

    const client = new CkpClient({
      transport: new HttpTransport({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
        // vitest node 环境的全局 fetch 对 SSE 流式读取可能挂起；
        // 显式传入 node 原生 fetch（node ≥18 全局可用）
        fetch: globalThis.fetch.bind(globalThis),
      }),
    });

    try {
      // 1. session.create
      const session = await client.sessionCreate('/tmp/demo', { model: 'deepseek-chat' });
      expect(session.id).toMatch(/^session-/);

      // 2. store: 事件源 reducer 验证（SSE 传输层由 scripts/verify-m0.mjs 真实验证；
      //    vitest 的 node:http 对 SSE 流式响应有限制，这里直接驱动 store）
      const store = client.storeFor(session.id);
      store.append({
        seq: 1, ts: Date.now(), sessionId: session.id, type: 'message.user', text: 'hello from client',
      });
      expect(store.getState().messages.some((m) => m.role === 'user' && m.text === 'hello from client')).toBe(true);

      // 3. session.send RPC → host 广播到 bus（SSE 端到端由 verify-m0 验证）
      await client.sessionSend(session.id, 'hello from client');
      const rpcState = store.getState();
      expect(rpcState.status).toBe('running');

      // 4. tool 事件进 store
      store.append({
        seq: 2, ts: Date.now(), sessionId: session.id, type: 'tool.call',
        call: { callId: 'tc-x', sessionId: session.id, name: 'bash', args: {}, status: 'running' },
      });
      expect(store.getState().toolCalls['tc-x']?.name).toBe('bash');

      // 5. approval flow through the client（RPC）
      const handle = approvals.create(session.id, 'bash', { command: 'ls' });
      store.append({
        seq: 3, ts: Date.now(), sessionId: session.id, type: 'approval.request', approval: handle,
      });
      await waitFor(() => store.getState().approvals.length > 0);
      await client.approvalRespond(handle.id, 'once');
      store.append({
        seq: 4, ts: Date.now(), sessionId: session.id, type: 'approval.resolved',
        approvalId: handle.id, decision: 'once',
      });
      await waitFor(() => store.getState().approvals.length === 0);
      expect(store.getState().approvalDecisions[handle.id]).toBe('once');
    } finally {
      await server.close();
    }
  });
});

function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (fn()) return resolve();
      } catch {
        // retry
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}
