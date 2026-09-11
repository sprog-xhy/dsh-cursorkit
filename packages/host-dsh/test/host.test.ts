import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/rpc/sse.ts';
import { translateRawEvent } from '../src/bridge/session-bridge.ts';
import { ApprovalBridge, inferRisks } from '../src/bridge/approval-bridge.ts';
import { tokenMatches, extractBearer } from '../src/rpc/auth.ts';
import { generateToken, writeRuntimeFile, readRuntimeFile, removeRuntimeFile } from '../src/runtime-file.ts';
import { checkVersion, CKP_PROTOCOL_VERSION } from '@dsh-cursorkit/protocol';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  it('maps dsh user/assistant/tool events to CKP events (real shapes)', () => {
    expect(
      translateRawEvent('s1', {
        type: 'user/message',
        data: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }], source: {} },
      }),
    ).toMatchObject({ sessionId: 's1', type: 'message.user', text: 'hello' });

    expect(
      translateRawEvent('s1', {
        type: 'assistant/chunk',
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hi ' } },
      }),
    ).toMatchObject({ type: 'message.delta', text: 'Hi ' });

    const done = translateRawEvent('s1', {
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'Hi there' }], source: {} } },
    });
    expect(done).toMatchObject({ type: 'message.done' });
    expect((done as { message: { text: string } }).message.text).toBe('Hi there');

    const toolCall = translateRawEvent('s1', {
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'tc1', name: 'bash', arguments: '{"command":"ls"}' },
    });
    expect(toolCall).toMatchObject({ type: 'tool.call' });
    expect((toolCall as { call: { callId: string; name: string; args: unknown } }).call).toMatchObject({
      callId: 'tc1',
      name: 'bash',
      args: { command: 'ls' },
    });

    // turn/start 现在不产生事件（此前产出空 delta → 前端出现空白助手气泡）
    expect(translateRawEvent('s1', { type: 'turn/start', data: { turn: 1 } })).toBeNull();
    // turn/end 现在会映射（原先丢弃 → 前端收不到"结束/取消"，busy 永远为 true）
    expect(translateRawEvent('s1', { type: 'turn/end', data: { turn: 1 } })).toMatchObject({
      type: 'done',
    });
  });

  it('maps tool/result to output and error variants (real dsh shapes)', () => {
    const ok = translateRawEvent('s1', {
      type: 'tool/result',
      data: { turn: 1, step: 1, message: { id: 'm3', role: 'user', content: [{ type: 'tool-result', toolCallId: 'tc1', content: [{ type: 'text', text: 'file1' }] }], source: {} } },
    });
    expect(ok).toMatchObject({ type: 'tool.output', callId: 'tc1' });

    const err = translateRawEvent('s1', {
      type: 'tool/result',
      data: { turn: 1, step: 1, message: { id: 'm4', role: 'user', content: [{ type: 'tool-result', toolCallId: 'tc2', content: [{ type: 'text', text: 'boom' }], isError: true }], source: {} } },
    });
    expect(err).toMatchObject({ type: 'tool.done', status: 'error' });
  });

  it('drops unknown internal events silently', () => {
    expect(translateRawEvent('s1', { type: 'request/header', data: {} })).toBeNull();
    expect(translateRawEvent('s1', { type: 'approval/asked', data: {} })).toBeNull();
    expect(translateRawEvent('s1', { type: 'approval/decided', data: {} })).toBeNull();
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

describe('EventBus snapshot persistence', () => {
  it('round-trips seq and ring across a restore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ckp-bus-'));
    const file = join(dir, 'bus.json');
    const bus1 = new EventBus();
    bus1.emit({ sessionId: 's1', type: 'message.user', text: 'a' });
    bus1.emit({ sessionId: 's1', type: 'message.delta', text: 'b' });
    await bus1.saveSnapshot(file);

    const bus2 = new EventBus();
    expect(await bus2.restoreSnapshot(file)).toBe(true);
    expect(bus2.lastSeq).toBe(2);
    const replay = bus2.replayFrom(1);
    expect(replay?.map((e) => e.seq)).toEqual([2]);
    expect(replay?.[0]).toMatchObject({ type: 'message.delta', text: 'b' });

    await bus2.clearSnapshot(file);
    const bus3 = new EventBus();
    expect(await bus3.restoreSnapshot(file)).toBe(false);
  });
});

describe('runtime-file', () => {
  it('writes and reads runtime.json with round-trip integrity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ckp-rt-'));
    const file = join(dir, 'runtime.json');
    const info = {
      pid: 1234,
      port: 8080,
      token: generateToken(),
      protocolVersion: CKP_PROTOCOL_VERSION,
      dshVersion: '0.1.1-rc.2',
      startedAt: new Date().toISOString(),
      pidfile: join(dir, 'host.pid'),
    };
    await writeRuntimeFile(file, info);
    const back = await readRuntimeFile(file);
    expect(back).toMatchObject({ pid: 1234, port: 8080, token: info.token });
    await removeRuntimeFile(file);
    expect(await readRuntimeFile(file)).toBeNull();
  });
});
