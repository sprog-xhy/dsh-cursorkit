/**
 * 历史会话恢复的扩展侧测试。
 *
 * 覆盖：
 * - CkpService.switchSession 会拉 session.history 并把事件派发给前端监听
 * - 订阅实时事件时使用 host 返回的 busSeq（不重复回放）
 * - 历史不可得时退化为从头订阅（不阻塞）
 * - ChatController 的消息顺序：先 session.switched（前端清空）再回放历史
 */
import { describe, it, expect } from 'vitest';
import type { Transport, SubscribeOptions, Disposer } from '@dsh-cursorkit/client';
import { CkpService } from '../src/ckp.ts';
import { ChatController } from '../src/chat-controller.ts';
import { SidecarManager } from '../src/sidecar.ts';
import { VirtualDocProvider } from '../src/virtual-docs.ts';
import type { ExtensionContext } from './stubs/vscode.ts';
import { Uri } from './stubs/vscode.ts';

const HISTORY_EVENTS = [
  { seq: 1, ts: 1, sessionId: 's1', type: 'message.user', text: '早先的问题' },
  { seq: 2, ts: 2, sessionId: 's1', type: 'message.delta', text: '早先的回复', turn: 1, step: 1 },
  { seq: 3, ts: 3, sessionId: 's1', type: 'message.done', message: { id: 'm1', role: 'assistant', text: '早先的回复', createdAt: 3 } },
];

class FakeTransport implements Transport {
  readonly kind = 'http' as const;
  calls: { method: string; params: unknown }[] = [];
  subscriptions: { sessionId: string; fromSeq: number }[] = [];
  /** 设为 true 让 history 抛错（模拟不可恢复） */
  failHistory = false;
  private handler: ((e: never) => void) | null = null;

  async call<P, R>(method: string, params: P): Promise<R> {
    this.calls.push({ method, params });
    if (method === 'session.get') {
      return {
        id: 's1',
        workspace: '/ws',
        model: 'wps/moonshot/kimi-k2.7-code',
        lastSeq: 3,
      } as unknown as R;
    }
    if (method === 'session.history') {
      if (this.failHistory) throw new Error('history unavailable');
      return {
        id: 's1',
        events: HISTORY_EVENTS,
        busSeq: 42,
        lastSeq: 3,
        resumed: true,
        truncated: false,
      } as unknown as R;
    }
    return undefined as unknown as R;
  }

  subscribe(sessionId: string, opts: SubscribeOptions): Disposer {
    this.subscriptions.push({ sessionId, fromSeq: opts.fromSeq });
    this.handler = opts.onEvent as (e: never) => void;
    return () => undefined;
  }

  /** 模拟 host 推送实时事件。 */
  push(evt: unknown): void {
    this.handler?.(evt as never);
  }
}

function fakeContext(): ExtensionContext {
  return {
    subscriptions: [],
    extension: { packageJSON: { version: '0.1.0-test' } },
    extensionUri: Uri.file(process.cwd()),
    secrets: { get: async () => undefined, store: async () => undefined },
    globalState: { get: (_k: string, d?: unknown) => d, update: async () => undefined },
  };
}

describe('CkpService.switchSession 历史恢复', () => {
  it('拉取历史并派发给监听（顺序一致）', async () => {
    const t = new FakeTransport();
    const ckp = new CkpService();
    ckp.attach(t as never);
    const seen: { type?: string; text?: string }[] = [];
    ckp.onEvent((e) => seen.push(e as { type?: string; text?: string }));

    const restored = await ckp.switchSession('s1');

    expect(restored).toBe(3);
    expect(seen.map((e) => e.type)).toEqual(['message.user', 'message.delta', 'message.done']);
    expect(seen[0].text).toBe('早先的问题');
    expect(t.calls.some((c) => c.method === 'session.history')).toBe(true);
  });

  it('实时订阅使用 busSeq（避免重复回放历史）', async () => {
    const t = new FakeTransport();
    const ckp = new CkpService();
    ckp.attach(t as never);
    await ckp.switchSession('s1');
    expect(t.subscriptions.at(-1)).toEqual({ sessionId: 's1', fromSeq: 42 });
  });

  it('历史不可得时退化为从头订阅且不抛错', async () => {
    const t = new FakeTransport();
    t.failHistory = true;
    const ckp = new CkpService();
    ckp.attach(t as never);
    const restored = await ckp.switchSession('s1');
    expect(restored).toBe(0);
    expect(t.subscriptions.at(-1)).toEqual({ sessionId: 's1', fromSeq: 0 });
  });

  it('切换到不存在的会话也不崩（history 抛错被吞掉）', async () => {
    const t = new FakeTransport();
    t.failHistory = true;
    const ckp = new CkpService();
    ckp.attach(t as never);
    await expect(ckp.switchSession('ghost')).resolves.toBe(0);
  });
});

describe('ChatController 会话切换顺序', () => {
  it('先广播 session.switched（前端清空）再回放历史事件', async () => {
    const t = new FakeTransport();
    const ckp = new CkpService();
    ckp.attach(t as never);
    const sidecar = new SidecarManager(fakeContext());
    const docs = new VirtualDocProvider();
    const controller = new ChatController(ckp, sidecar, docs, fakeContext());

    const posted: { type?: string }[] = [];
    const host = {
      hostId: 'test-host',
      kind: 'panel' as const,
      context: fakeContext(),
      webview: { postMessage: async () => true } as never,
      post: (msg: unknown) => posted.push(msg as { type?: string }),
    };
    controller.attach(host);
    posted.length = 0; // 忽略 attach 时的 init/review.list

    await controller.handleMessage({ type: 'session.switch', sessionId: 's1' }, host);

    const types = posted.map((m) => m.type);
    expect(types[0]).toBe('session.switched'); // 必须最先（前端据此清空）
    expect(types.filter((x) => x === 'event')).toHaveLength(3);
    expect(types.indexOf('session.switched')).toBeLessThan(types.indexOf('event'));

    controller.dispose();
    sidecar.dispose();
  });
});
