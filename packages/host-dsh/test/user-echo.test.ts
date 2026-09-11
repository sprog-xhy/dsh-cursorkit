/**
 * 用户消息去重（修复"每条消息渲染两次"）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  noteEchoedUserMessage,
  consumeEchoedUserMessage,
  resetEchoRegistry,
  ECHO_MAX,
  ECHO_TTL_MS,
} from '../src/bridge/user-echo.ts';
import { translateRawEvent } from '../src/bridge/session-bridge.ts';

const S = 's1';

beforeEach(() => resetEchoRegistry());

describe('user-echo 登记表', () => {
  it('登记过的 id 被消费一次（第二次不再命中）', () => {
    noteEchoedUserMessage('m1');
    expect(consumeEchoedUserMessage('m1')).toBe(true);
    expect(consumeEchoedUserMessage('m1')).toBe(false);
  });

  it('未登记的 id 不命中', () => {
    expect(consumeEchoedUserMessage('nope')).toBe(false);
  });

  it('空 id 安全（不抛错、不命中）', () => {
    noteEchoedUserMessage(undefined);
    expect(consumeEchoedUserMessage(undefined)).toBe(false);
  });

  it('超过 TTL 的登记不再命中', () => {
    noteEchoedUserMessage('old', 1000);
    expect(consumeEchoedUserMessage('old', 1000 + ECHO_TTL_MS + 1)).toBe(false);
  });

  it('登记表有上限（不会无限增长）', () => {
    for (let i = 0; i < ECHO_MAX + 50; i++) noteEchoedUserMessage(`m${i}`, 1000);
    // 最旧的已被淘汰
    expect(consumeEchoedUserMessage('m0', 1000)).toBe(false);
    // 最新的仍在
    expect(consumeEchoedUserMessage(`m${ECHO_MAX + 49}`, 1000)).toBe(true);
  });
});

describe('bridge 与乐观事件配合（端到端语义）', () => {
  it('乐观事件已发出的消息，bridge 不再重复翻译', () => {
    noteEchoedUserMessage('msg-1');
    const evt = translateRawEvent(S, {
      type: 'user/message',
      data: { id: 'msg-1', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
    });
    expect(evt).toBeNull();
  });

  it('未登记的消息照常翻译（例如其它客户端发送的）', () => {
    const evt = translateRawEvent(S, {
      type: 'user/message',
      data: { id: 'msg-2', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
    });
    expect(evt).toMatchObject({ type: 'message.user', text: '你好' });
  });

  it('turn/start 不再产生空 delta（幽灵空白回复）', () => {
    expect(translateRawEvent(S, { type: 'turn/start', data: { turn: 1 } })).toBeNull();
  });
});
