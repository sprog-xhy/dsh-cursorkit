/**
 * bridge 的 turn/step 透传与空分片过滤测试。
 * 修复：① 轮次信息被丢弃导致前端无法归组 ② 空文本分片仍被广播成 message.delta
 *      ③ reasoning 分片没有走 thinking 事件
 */
import { describe, it, expect } from 'vitest';
import { translateRawEvent } from '../src/bridge/session-bridge.ts';

const S = 'session-1';

describe('translateRawEvent: assistant/chunk', () => {
  it('text-delta → message.delta 且携带 turn/step', () => {
    const evt = translateRawEvent(S, {
      type: 'assistant/chunk',
      data: { turn: 2, step: 3, chunk: { type: 'text-delta', text: 'hello' } },
    });
    expect(evt).toMatchObject({ type: 'message.delta', text: 'hello', turn: 2, step: 3 });
  });

  it('reasoning-delta → thinking.delta（不混进正文）', () => {
    const evt = translateRawEvent(S, {
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: '在想…' } },
    });
    expect(evt).toMatchObject({ type: 'thinking.delta', text: '在想…', turn: 1, step: 1 });
  });

  it('空文本分片不再产生事件（原先广播空 delta）', () => {
    expect(
      translateRawEvent(S, { type: 'assistant/chunk', data: { turn: 1, chunk: { type: 'text-delta', text: '' } } }),
    ).toBeNull();
  });

  it('非文本分片（block-start/usage/finish/tool-call-delta）不产生事件', () => {
    for (const type of ['block-start', 'block-end', 'usage', 'finish', 'tool-call-delta']) {
      expect(
        translateRawEvent(S, { type: 'assistant/chunk', data: { turn: 1, chunk: { type } } }),
        `${type} 不应产生事件`,
      ).toBeNull();
    }
  });

  it('缺少 turn/step 时不报错（字段省略）', () => {
    const evt = translateRawEvent(S, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'text-delta', text: 'x' } },
    }) as Record<string, unknown> | null;
    expect(evt).not.toBeNull();
    expect(evt?.turn).toBeUndefined();
    expect(evt?.step).toBeUndefined();
  });
});

describe('translateRawEvent: tool/call', () => {
  it('携带 turn/step（供 UI 与文本一起归组）', () => {
    const evt = translateRawEvent(S, {
      type: 'tool/call',
      data: { turn: 1, step: 2, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' },
    });
    expect(evt).toMatchObject({ type: 'tool.call', turn: 1, step: 2 });
  });

  it('arguments 是字符串时解析为对象', () => {
    const evt = translateRawEvent(S, {
      type: 'tool/call',
      data: { callId: 'c2', name: 'read', arguments: '{"path":"a.ts"}' },
    }) as { call?: { args?: Record<string, unknown> } } | null;
    expect(evt?.call?.args).toEqual({ path: 'a.ts' });
  });

  it('arguments 非法 JSON 时退化为 { raw }', () => {
    const evt = translateRawEvent(S, {
      type: 'tool/call',
      data: { callId: 'c3', name: 'x', arguments: 'not-json' },
    }) as { call?: { args?: Record<string, unknown> } } | null;
    expect(evt?.call?.args).toEqual({ raw: 'not-json' });
  });
});
