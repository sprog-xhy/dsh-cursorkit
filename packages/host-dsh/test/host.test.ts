import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/rpc/sse.ts';
import { translateRawEvent } from '../src/bridge/session-bridge.ts';
import { ApprovalBridge, inferRisks } from '../src/bridge/approval-bridge.ts';
import { tokenMatches, extractBearer } from '../src/rpc/auth.ts';
import { generateToken } from '../src/runtime-file.ts';
import { checkVersion, CKP_PROTOCOL_VERSION } from '@dsh-cursorkit/protocol';

describe('EventBus', () => {
  it('assigns monotonic seq and timestamps', () => {
    const bus = new EventBus();
    const a = bus.emit({ sessionId: 's1', type: 'message.user', text: 'hi' });
    const b = bus.emit({ sessionId: 's1', type: 'message.delta', text: 'x' });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(typeof a.ts).toBe('number');
  });

  it('replays from a seq within the ring', () => {
    const bus = new EventBus(3);
    for (let i = 0; i < 5; i++) bus.emit({ sessionId: 's', type: 'message.delta', text: String(i) });
    const replay = bus.replayFrom(2);
    expect(replay).not.toBeNull();
    expect(replay!.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it('returns null when the requested seq is older than the ring', () => {
    const bus = new EventBus(2);
    bus.emit({ sessionId: 's', type: 'message.user', text: 'a' });
    bus.emit({ sessionId: 's', type: 'message.user', text: 'b' });
    bus.emit({ sessionId: 's', type: 'message.user', text: 'c' });
    expect(bus.replayFrom(0)).toBeNull();
  });

  it('subscribes and delivers, disposer stops delivery', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const dispose = bus.subscribe({ onEvent: fn });
    bus.emit({ sessionId: 's', type: 'message.user', text: 'a' });
    expect(fn).toHaveBeenCalledTimes(1);
    dispose();
    bus.emit({ sessionId: 's', type: 'message.user', text: 'b' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('contains subscriber errors', () => {
    const bus = new EventBus();
    const boom = vi.fn(() => {
      throw new Error('subscriber boom');
    });
    const ok = vi.fn();
    bus.subscribe({ onEvent: boom });
    bus.subscribe({ onEvent: ok });
    expect(() => bus.emit({ sessionId: 's', type: 'message.user', text: 'a' })).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('session-bridge translation', () => {
  it('maps user/assistant/tool events to CKP events', () => {
    expect(translateRawEvent('s1', { type: 'user/message', data: { text: 'hello' } })).toMatchObject({
      sessionId: 's1',
      type: 'message.user',
      text: 'hello',
    });
    expect(translateRawEvent('s1', { type: 'assistant/chunk', data: { text: 'Hi ' } })).toMatchObject({
      type: 'message.delta',
      text: 'Hi ',
    });
    const toolCall = translateRawEvent('s1', {
      type: 'tool/call',
      data: { toolCallId: 'tc1', toolName: 'bash', args: { command: 'ls' } },
    });
    expect(toolCall).toMatchObject({ type: 'tool.call' });
    expect((toolCall as { call: { callId: string; name: string } }).call.callId).toBe('tc1');
    expect(translateRawEvent('s1', { type: 'done', data: {} })).toMatchObject({ type: 'done', status: 'done' });
  });

  it('ignores unknown event types', () => {
    expect(translateRawEvent('s1', { type: 'internal/whatever', data: {} })).toBeNull();
  });
});

describe('ApprovalBridge', () => {
  it('creates a pending approval, broadcasts request, resolves via respond', () => {
    const bus = new EventBus();
    const events: Array<{ type: string; approvalId?: string; decision?: string }> = [];
    bus.subscribe({
      onEvent: (e) => events.push({ type: e.type, approvalId: (e as { approvalId?: string }).approvalId, decision: (e as { decision?: string }).decision }),
    });
    const bridge = new ApprovalBridge({ bus, timeoutMs: 60_000 });
    const h = bridge.create('s1', 'bash', { command: 'rm -rf /' }, 'needs approval');
    expect(events[0]?.type).toBe('approval.request');
    expect(bridge.respond(h.id, 'once')).toBe(true);
    expect(events[1]).toMatchObject({ type: 'approval.resolved', approvalId: h.id, decision: 'once' });
    // second respond is a no-op
    expect(bridge.respond(h.id, 'deny')).toBe(false);
  });

  it('auto-denies on timeout', async () => {
    const bus = new EventBus();
    const events: Array<{ type: string; decision?: string }> = [];
    bus.subscribe({ onEvent: (e) => events.push({ type: e.type, decision: (e as { decision?: string }).decision }) });
    const bridge = new ApprovalBridge({ bus, timeoutMs: 5 });
    const h = bridge.create('s1', 'bash', {});
    await new Promise((r) => setTimeout(r, 30));
    expect(events.some((e) => e.type === 'approval.resolved' && e.decision === 'deny')).toBe(true);
    void h;
  });

  it('infers risk categories from tool names', () => {
    expect(inferRisks('str_replace_editor')).toContain('write');
    expect(inferRisks('bash')).toContain('shell');
    expect(inferRisks('web_search')).toContain('network');
  });
});

describe('auth', () => {
  it('matches tokens in constant time and parses bearer headers', () => {
    const t = generateToken();
    expect(tokenMatches(`Bearer ${t}`.replace(/^Bearer\s+/, ''), t)).toBe(true);
    expect(tokenMatches('wrong', t)).toBe(false);
    expect(tokenMatches(undefined, t)).toBe(false);
    expect(extractBearer(`Bearer ${t}`)).toBe(t);
    expect(extractBearer(undefined)).toBeUndefined();
  });

  it('token is 64 hex chars', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('protocol version alignment', () => {
  it('host advertises a version the client accepts', () => {
    const r = checkVersion(CKP_PROTOCOL_VERSION);
    expect(r.compatible).toBe(true);
  });
});
