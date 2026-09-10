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
      transport: new HttpTransport({ baseUrl: `http://127.0.0.1:${server.port}`, token }),
    });

    try {
      // 1. session.create
      const session = await client.sessionCreate('/tmp/demo', { model: 'deepseek-chat' });
      expect(session.id).toMatch(/^session-/);

      // 2. subscribe (store receives events)
      const store = client.storeFor(session.id);
      const events: string[] = [];
      const dispose = client.subscribeSession(session.id, {
        onEvent: (e) => events.push(e.type),
      });

      // 3. session.send → host emits message.user on the bus → SSE → store
      await client.sessionSend(session.id, 'hello from client');
      await waitFor(() => store.getState().messages.length > 0);

      const state = store.getState();
      expect(state.messages.some((m) => m.role === 'user' && m.text === 'hello from client')).toBe(true);
      expect(events).toContain('message.user');

      // 4. host-side tool event flows to the store
      bus.emit({
        sessionId: session.id,
        type: 'tool.call',
        call: { callId: 'tc-x', sessionId: session.id, name: 'bash', args: {}, status: 'running' },
      });
      await waitFor(() => store.getState().toolCalls['tc-x'] !== undefined);
      expect(store.getState().toolCalls['tc-x']?.name).toBe('bash');

      // 5. approval flow through the client
      const handle = approvals.create(session.id, 'bash', { command: 'ls' });
      await waitFor(() => store.getState().approvals.length > 0);
      await client.approvalRespond(handle.id, 'once');
      await waitFor(() => store.getState().approvals.length === 0);
      expect(store.getState().approvalDecisions[handle.id]).toBe('once');

      dispose();
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
