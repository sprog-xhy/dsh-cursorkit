/**
 * SSE 会话隔离测试（P0 回归）。
 *
 * 真实 bug：SSE 端点既不过滤回放窗口、也不过滤实时事件
 * （源码里留着 `void sessionId;`），导致多会话时 A 的流里混进 B 的消息。
 *
 * 实现说明：这里用 node:http 原生客户端读流。
 * vitest 环境下的全局 fetch 在"服务端持续写入的 SSE 流"上会死锁（实测），
 * 原生 http 客户端可以正常增量读取。
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { startServer } from '../src/rpc/server.ts';
import { EventBus } from '../src/rpc/sse.ts';
import { ApprovalBridge } from '../src/bridge/approval-bridge.ts';
import type { CapabilityReport } from '../src/capability.ts';
import type { SessionStoreView, AgentRegistryView } from '../src/compat/sessions.ts';

const report: CapabilityReport = {
  dshVersion: '0.1.1-rc.2',
  required: { ok: true, missing: [] },
  optional: {},
  probedAt: new Date().toISOString(),
};
const sessions: SessionStoreView = {
  create: () => ({ id: 's-a', header: { cwd: '/tmp', createdAt: 1 }, seq: 0 }),
  get: (id: string) => ({ id, header: { cwd: '/tmp', createdAt: 1 }, seq: 0 }),
  list: () => [],
};
const agents: AgentRegistryView = { get: () => undefined, list: () => [] };

/** 打开 SSE 流并收集 data 行；返回停止函数与收集到的行。 */
function openStream(
  port: number,
  path: string,
): { lines: string[]; close: () => void; ready: Promise<void> } {
  const lines: string[] = [];
  let buf = '';
  let req: http.ClientRequest | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    req = http.request({ host: '127.0.0.1', port, path, headers: { authorization: 'Bearer t' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      resolve();
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const d = p.split('\n').find((l) => l.startsWith('data:'));
          if (d) lines.push(d.slice(5).trim());
        }
      });
      res.on('error', () => undefined);
    });
    req.on('error', reject);
    req.end();
  });
  return {
    lines,
    ready,
    close: () => {
      req?.destroy();
    },
  };
}

describe('SSE 按会话过滤', () => {
  it('实时事件：订阅 A 不会收到 B 的事件', async () => {
    const bus = new EventBus();
    const server = await startServer({
      token: 't',
      capabilities: report,
      bus,
      approvals: new ApprovalBridge({ bus }),
      sessions,
      agents,
      appVersion: '0.1.1-rc.2',
    });
    const stream = openStream(server.port, '/v1/sessions/s-a/events?from=0');
    try {
      await stream.ready;
      bus.emit({ sessionId: 's-b', type: 'message.user', text: 'B-msg' } as never);
      bus.emit({ sessionId: 's-a', type: 'message.user', text: 'A-msg' } as never);
      await new Promise((r) => setTimeout(r, 300));
      const joined = stream.lines.join('\n');
      expect(joined).toContain('A-msg');
      expect(joined, 'A 的流里不应出现 B 的消息').not.toContain('B-msg');
    } finally {
      stream.close();
      await server.close();
    }
  }, 20_000);

  it('回放窗口：跨会话历史不串台', async () => {
    const bus = new EventBus();
    bus.emit({ sessionId: 's-b', type: 'message.user', text: 'B-hist' } as never);
    bus.emit({ sessionId: 's-a', type: 'message.user', text: 'A-hist' } as never);
    const server = await startServer({
      token: 't',
      capabilities: report,
      bus,
      approvals: new ApprovalBridge({ bus }),
      sessions,
      agents,
      appVersion: '0.1.1-rc.2',
    });
    const stream = openStream(server.port, '/v1/sessions/s-a/events?from=0');
    try {
      await stream.ready;
      await new Promise((r) => setTimeout(r, 200));
      const joined = stream.lines.join('\n');
      expect(joined).toContain('A-hist');
      expect(joined, '回放不应包含其它会话的事件').not.toContain('B-hist');
    } finally {
      stream.close();
      await server.close();
    }
  }, 20_000);
});
