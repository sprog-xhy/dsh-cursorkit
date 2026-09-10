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

describe('translateRawEvent: turn/end（修复"停止没反应"）', () => {
  it('aborted → cancelled 事件（否则前端永远停在"生成中"）', () => {
    const evt = translateRawEvent(S, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'aborted', reason: { keepInbox: false } } },
    });
    expect(evt).toMatchObject({ type: 'cancelled', turn: 1 });
  });

  it('error → error 事件并带上错误信息', () => {
    const evt = translateRawEvent(S, {
      type: 'turn/end',
      data: { turn: 2, reason: { kind: 'error', error: { message: 'UNKNOWN_MODEL', code: 'X' } } },
    }) as { type?: string; message?: string } | null;
    expect(evt?.type).toBe('error');
    expect(evt?.message).toBe('UNKNOWN_MODEL');
  });

  it('completed → done（status=idle）', () => {
    const evt = translateRawEvent(S, {
      type: 'turn/end',
      data: { turn: 3, reason: { kind: 'completed' } },
    }) as { type?: string; status?: string } | null;
    expect(evt).toMatchObject({ type: 'done', status: 'idle' });
  });

  it('blocked → done（不让前端卡在运行中）', () => {
    const evt = translateRawEvent(S, {
      type: 'turn/end',
      data: { turn: 4, reason: { kind: 'blocked' } },
    }) as { type?: string } | null;
    expect(evt?.type).toBe('done');
  });

  it('缺 reason 时按 completed 处理（容错）', () => {
    const evt = translateRawEvent(S, { type: 'turn/end', data: { turn: 5 } }) as { type?: string } | null;
    expect(evt?.type).toBe('done');
  });
});

describe('translateRawEvent: user/message 只渲染真实用户消息（修复气泡污染）', () => {
  it('source.kind=user → message.user', () => {
    const evt = translateRawEvent(S, {
      type: 'user/message',
      data: {
        content: [{ type: 'text', text: '你好' }],
        source: { kind: 'user' },
      },
    });
    expect(evt).toMatchObject({ type: 'message.user', text: '你好' });
  });

  it('source.kind=plugin（系统提示快照）→ 丢弃', () => {
    expect(
      translateRawEvent(S, {
        type: 'user/message',
        data: {
          content: [{ type: 'text', text: 'Current runtime context…' }],
          source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
        },
      }),
    ).toBeNull();
  });

  it('source.kind=skill-catalog → 丢弃', () => {
    expect(
      translateRawEvent(S, {
        type: 'user/message',
        data: { content: [{ type: 'text', text: 'skill list' }], source: { kind: 'skill-catalog' } },
      }),
    ).toBeNull();
  });

  it('source.kind=tool（工具结果）→ 丢弃', () => {
    expect(
      translateRawEvent(S, {
        type: 'user/message',
        data: { content: [{ type: 'text', text: 'tool result' }], source: { kind: 'tool' } },
      }),
    ).toBeNull();
  });

  it('无 source 信息时保持兼容（仍按用户消息）', () => {
    const evt = translateRawEvent(S, { type: 'user/message', data: { text: 'legacy' } });
    expect(evt).toMatchObject({ type: 'message.user', text: 'legacy' });
  });
});

describe('translateRawEvent: session/title 与持久化分片行', () => {
  it('session/title → session.title 事件', () => {
    const evt = translateRawEvent(S, { type: 'session/title', data: { title: '解释项目架构' } });
    expect(evt).toMatchObject({ type: 'session.title', title: '解释项目架构' });
  });

  it('空标题不产生事件', () => {
    expect(translateRawEvent(S, { type: 'session/title', data: { title: '  ' } })).toBeNull();
  });

  it('text-chunks（持久化行）防御性展开为 message.delta', () => {
    const evt = translateRawEvent(S, {
      type: 'text-chunks',
      data: { turn: 1, step: 1, chunks: [{ text: '你' }, { text: '好' }] },
    });
    expect(evt).toMatchObject({ type: 'message.delta', text: '你好' });
  });

  it('reasoning-chunks 展开为 thinking.delta', () => {
    const evt = translateRawEvent(S, {
      type: 'reasoning-chunks',
      data: { chunks: [{ text: '想' }, { text: '一下' }] },
    });
    expect(evt).toMatchObject({ type: 'thinking.delta', text: '想一下' });
  });
});
