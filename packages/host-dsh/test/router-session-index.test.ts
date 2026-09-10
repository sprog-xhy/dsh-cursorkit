/**
 * Router 与会话索引的集成测试。
 * 修复：dsh 重启后旧会话不载入内存 → session.get 报 NOT_FOUND、session.list 为空。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Router, type RouterServices } from '../src/rpc/router.ts';
import { EventBus } from '../src/rpc/sse.ts';
import { ApprovalBridge } from '../src/bridge/approval-bridge.ts';
import type { CapabilityReport } from '../src/capability.ts';
import type { SessionIndexEntry } from '../src/session-index.ts';

function makeReport(): CapabilityReport {
  return {
    dshVersion: '0.1.1-rc.2',
    required: { ok: true, missing: [] },
    optional: {},
    probedAt: new Date().toISOString(),
  };
}

interface Harness {
  router: Router;
  index: Map<string, SessionIndexEntry>;
  live: Set<string>;
  resumeCalls: string[];
  sent: unknown[];
}

function harness(opts: { liveSessions?: string[]; indexed?: Record<string, SessionIndexEntry> } = {}): Harness {
  const index = new Map<string, SessionIndexEntry>(Object.entries(opts.indexed ?? {}));
  const live = new Set<string>(opts.liveSessions ?? []);
  const resumeCalls: string[] = [];
  const sent: unknown[] = [];

  const sessions = {
    create: (id?: string) => {
      const sid = id ?? `session-${Math.random().toString(36).slice(2, 8)}`;
      live.add(sid);
      return { id: sid, header: { cwd: '/ws', createdAt: Date.now() }, seq: 0 };
    },
    get: (id: string) => (live.has(id) ? { id, header: { cwd: '/ws', createdAt: 1 }, seq: 3 } : undefined),
    list: () => [...live].map((id) => ({ id, header: { cwd: '/ws', createdAt: 1 }, seq: 3 })),
  };

  const agents = {
    get: (id: string) =>
      live.has(id)
        ? {
            send: (m: unknown) => sent.push(m),
            cancel: async () => undefined,
            inbox: { append: (m: unknown) => sent.push(m) },
          }
        : undefined,
    list: () => [],
    create: async ({ sessionId }: { sessionId: string }) => {
      live.add(sessionId);
      return { agent: { id: sessionId } };
    },
    resume: async ({ resumeSessionId }: { resumeSessionId: string }) => {
      resumeCalls.push(resumeSessionId);
      // 模拟 dsh：只有持久化里确实存在的会话才能恢复
      if (!(resumeSessionId in Object.fromEntries(index))) {
        throw new Error(`session ${resumeSessionId} not persisted`);
      }
      live.add(resumeSessionId);
      return { agent: { id: resumeSessionId } };
    },
  };

  const bus = new EventBus();
  const services: RouterServices = {
    sessions: sessions as never,
    agents: agents as never,
    approvals: new ApprovalBridge({ bus }),
    bus,
    capabilities: makeReport(),
    dshVersion: '0.1.1-rc.2',
    sessionIndex: {
      get: (id) => index.get(id),
      modelOf: (id) => index.get(id)?.model,
      titleOf: (id) => index.get(id)?.title,
      set: (id, entry) => {
        index.set(id, entry);
      },
      all: () => [...index.entries()],
    },
  };
  return { router: new Router(services), index, live, resumeCalls, sent };
}

describe('Router × sessionIndex', () => {
  it('session.list 带上会话标题（summary 字段）', async () => {
    const h = harness({ indexed: { 's-old': { model: 'm/a', workspace: '/w', createdAt: 1, title: '解释项目架构' } } });
    const list = await h.router.dispatch('session.list', {} as never);
    const row = list.find((x) => x.id === 's-old');
    expect(row?.summary).toBe('解释项目架构');
  });

  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('session.create 写入索引（模型/工作区/时间）', async () => {
    const s = await h.router.dispatch('session.create', {
      workspace: '/ws',
      model: 'wps/moonshot/kimi-k2.7-code',
    });
    const entry = h.index.get(s.id);
    expect(entry?.model).toBe('wps/moonshot/kimi-k2.7-code');
    expect(entry?.workspace).toBe('/ws');
    expect(typeof entry?.createdAt).toBe('number');
  });

  it('session.list 合并"已索引但未载入内存"的历史会话', async () => {
    await h.router.dispatch('session.create', { workspace: '/ws', model: 'm/a' });
    // 模拟重启：内存清空，索引仍在
    h.live.clear();
    h.index.set('session-old', { model: 'm/old', workspace: '/old', createdAt: 5 });

    const list = await h.router.dispatch('session.list', {} as never);
    const ids = list.map((x) => x.id);
    expect(ids).toContain('session-old');
    const old = list.find((x) => x.id === 'session-old');
    expect(old?.model).toBe('m/old');
    expect(old?.workspace).toBe('/old');
  });

  it('session.get 对非活跃但已索引的会话返回元数据（而非 NOT_FOUND）', async () => {
    h.index.set('session-old', { model: 'm/old', workspace: '/old', createdAt: 5 });
    const detail = await h.router.dispatch('session.get', { id: 'session-old' });
    expect(detail.model).toBe('m/old');
    expect(detail.workspace).toBe('/old');
    expect(detail.lastSeq).toBe(0); // 需要完整回放
  });

  it('session.get 对完全未知的会话仍报 NOT_FOUND', async () => {
    await expect(h.router.dispatch('session.get', { id: 'nope' })).rejects.toThrow(/not found/i);
  });

  it('session.send 对历史会话先 resume 再发送', async () => {
    h.index.set('session-old', { model: 'wps/moonshot/kimi-k2.7-code', workspace: '/old', createdAt: 5 });
    expect(h.live.has('session-old')).toBe(false);

    await h.router.dispatch('session.send', { id: 'session-old', text: '继续' });

    expect(h.resumeCalls).toEqual(['session-old']);
    expect(h.live.has('session-old')).toBe(true);
    expect(h.sent.length).toBeGreaterThan(0);
  });

  it('完全未知的会话 → NOT_FOUND（不尝试 resume）', async () => {
    await expect(h.router.dispatch('session.send', { id: 'ghost', text: 'hi' })).rejects.toThrow(
      /not found/i,
    );
    expect(h.resumeCalls).toEqual([]);
  });

  it('已索引但恢复失败 → 报可诊断的"无法恢复"错误', async () => {
    const hh = harness({ indexed: { broken: { model: 'm', workspace: '/w', createdAt: 1 } } });
    (hh.router as unknown as { services: RouterServices }).services.agents.resume = async () => {
      throw new Error('resume failed');
    };
    await expect(hh.router.dispatch('session.send', { id: 'broken', text: 'hi' })).rejects.toThrow(
      /无法恢复/,
    );
  });
});
