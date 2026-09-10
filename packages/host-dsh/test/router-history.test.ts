/**
 * session.history 测试（历史会话恢复）。
 *
 * 覆盖：非活跃会话先 resume、dsh 原始日志 → CKP 事件翻译、
 * busSeq 返回（供客户端只订阅实时）、limit 截断保留尾部、完全未知会话报错。
 */
import { describe, it, expect } from 'vitest';
import { Router, deriveSessionTitle, type RouterServices } from '../src/rpc/router.ts';
import { EventBus } from '../src/rpc/sse.ts';
import { ApprovalBridge } from '../src/bridge/approval-bridge.ts';
import type { CapabilityReport } from '../src/capability.ts';
import type { SessionIndexEntry } from '../src/session-index.ts';

const report: CapabilityReport = {
  dshVersion: '0.1.1-rc.2',
  required: { ok: true, missing: [] },
  optional: {},
  probedAt: new Date().toISOString(),
};

/** 模拟 dsh 持久化日志（恢复后的 session.events）。 */
const HISTORY = [
  { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '帮我改代码' }], role: 'user' } },
  { seq: 2, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '好的' } } },
  { seq: 3, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '，我看一下' } } },
  { seq: 4, type: 'tool/call', data: { turn: 1, step: 2, callId: 'c1', name: 'read', arguments: '{"path":"a.ts"}' } },
  { seq: 5, type: 'tool/result', data: { turn: 1, step: 2, message: { content: [{ toolCallId: 'c1', isError: false }] } } },
  { seq: 6, type: 'turn/end', data: { turn: 1, reason: { kind: 'done' } } },
];

function harness(opts: { live?: boolean; indexed?: Record<string, SessionIndexEntry> } = {}) {
  const index = new Map<string, SessionIndexEntry>(Object.entries(opts.indexed ?? {}));
  const live = new Set<string>(opts.live ? ['s1'] : []);
  const resumeCalls: string[] = [];
  const bus = new EventBus();

  const sessions = {
    get: (id: string) =>
      live.has(id)
        ? { id, header: { cwd: '/ws', createdAt: 1 }, seq: HISTORY.length, events: HISTORY }
        : undefined,
    list: () => [],
    create: () => ({ id: 'x', header: { cwd: '/ws', createdAt: 1 }, seq: 0 }),
  };
  const agents = {
    get: () => undefined,
    list: () => [],
    resume: async ({ resumeSessionId }: { resumeSessionId: string }) => {
      resumeCalls.push(resumeSessionId);
      if (!index.has(resumeSessionId)) throw new Error('not persisted');
      live.add(resumeSessionId);
      return { agent: { id: resumeSessionId } };
    },
  };

  const services: RouterServices = {
    sessions: sessions as never,
    agents: agents as never,
    approvals: new ApprovalBridge({ bus }),
    bus,
    capabilities: report,
    dshVersion: '0.1.1-rc.2',
    sessionIndex: {
      get: (id) => index.get(id),
      modelOf: (id) => index.get(id)?.model,
      titleOf: (id) => index.get(id)?.title,
      setTitle: (id, title) => index.set(id, { ...(index.get(id) ?? { model: '', workspace: '', createdAt: Date.now() }), title }),
      set: (id, e) => {
        index.set(id, e);
      },
      all: () => [...index.entries()],
    },
  };
  return { router: new Router(services), resumeCalls, bus, live, index };
}

describe('session.history', () => {
  it('活跃会话：直接回放其事件日志（user/delta/tool）', async () => {
    const h = harness({ live: true });
    const res = await h.router.dispatch('session.history', { id: 's1' });
    const types = res.events.map((e) => e.type);
    expect(types).toContain('message.user');
    expect(types).toContain('message.delta');
    expect(types).toContain('tool.call');
    expect(res.resumed).toBe(false);
    expect(res.truncated).toBe(false);
    // 事件必须带递增 seq（前端按 seq 渲染）
    expect(res.events.map((e) => e.seq)).toEqual(res.events.map((_, i) => i + 1));
  });

  it('历史事件内容正确（用户文本 + 助手增量拼接 + 工具名）', async () => {
    const h = harness({ live: true });
    const res = await h.router.dispatch('session.history', { id: 's1' });
    const userText = res.events.filter((e) => e.type === 'message.user').map((e) => e.text).join('');
    const assistant = res.events.filter((e) => e.type === 'message.delta').map((e) => e.text).join('');
    const toolName = res.events.find((e) => e.type === 'tool.call')?.call.name;
    expect(userText).toContain('帮我改代码');
    expect(assistant).toBe('好的，我看一下');
    expect(toolName).toBe('read');
  });

  it('非活跃但已索引：先 resume 再回放（resumed=true）', async () => {
    const h = harness({ indexed: { s1: { model: 'wps/moonshot/kimi-k2.7-code', workspace: '/ws', createdAt: 1 } } });
    const res = await h.router.dispatch('session.history', { id: 's1' });
    expect(h.resumeCalls).toEqual(['s1']);
    expect(res.resumed).toBe(true);
    expect(res.events.length).toBeGreaterThan(0);
  });

  it('返回 busSeq 供客户端只订阅实时事件（不重复回放）', async () => {
    const h = harness({ live: true });
    h.bus.emit({ sessionId: 'other', type: 'message.user', text: 'x' } as never);
    const before = h.bus.lastSeq;
    const res = await h.router.dispatch('session.history', { id: 's1' });
    expect(res.busSeq).toBe(before);
  });

  it('limit 截断保留最近的事件（truncated=true）', async () => {
    const h = harness({ live: true });
    const res = await h.router.dispatch('session.history', { id: 's1', limit: 2 });
    expect(res.truncated).toBe(true);
    expect(res.events.length).toBeLessThanOrEqual(2);
  });

  it('完全未知的会话 → NOT_FOUND（不尝试 resume）', async () => {
    const h = harness();
    await expect(h.router.dispatch('session.history', { id: 'ghost' })).rejects.toThrow(/not found/i);
    expect(h.resumeCalls).toEqual([]);
  });

  it('会话存在但 resume 失败 → 报"无法恢复"', async () => {
    const h = harness({ indexed: { s1: { model: 'm', workspace: '/ws', createdAt: 1 } } });
    (h.router as unknown as { services: RouterServices }).services.agents.resume = async () => {
      throw new Error('boom');
    };
    await expect(h.router.dispatch('session.history', { id: 's1' })).rejects.toThrow(/无法恢复/);
  });
});

describe('deriveSessionTitle（旧会话标题回填）', () => {
  it('优先用 session/title 并清洗模式提示', () => {
    expect(
      deriveSessionTitle([
        { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '问题' }] } },
        { type: 'session/title', data: { title: '解释项目架构 [模式: Agent] 如果…' } },
      ]),
    ).toBe('解释项目架构');
  });

  it('没有 title 事件时用首条真实用户消息', () => {
    expect(
      deriveSessionTitle([
        { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '系统提示' }] } },
        { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我修白屏\n\n[模式: Agent] xxx' }] } },
      ]),
    ).toBe('帮我修白屏');
  });

  it('只有系统注入时不产生标题', () => {
    expect(
      deriveSessionTitle([
        { type: 'user/message', data: { source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'skills' }] } },
      ]),
    ).toBeUndefined();
  });
});
