import { describe, expect, it } from 'vitest';
import { reduceEvents, initialState, rootReducer } from '@dsh-cursorkit/client';
import { buildTrajectory, groupBySource } from '../src/trajectory/trajectory.ts';
import type { CkpEvent } from '@dsh-cursorkit/protocol';

function ev(seq: number, e: Omit<CkpEvent, 'seq' | 'ts' | 'sessionId'> & { sessionId?: string }): CkpEvent {
  return { seq, ts: 1000 + seq, sessionId: e.sessionId ?? 's1', ...e } as unknown as CkpEvent;
}

function stateWithMix() {
  let state = initialState();
  state = rootReducer(state, ev(1, { type: 'session.started', workspace: '/w' }));
  state = rootReducer(state, ev(2, { type: 'message.user', text: '列出文件' }));
  state = rootReducer(state, ev(3, { type: 'message.delta', text: '正在' }));
  state = rootReducer(state, ev(4, { type: 'message.delta', text: '处理' }));
  state = rootReducer(
    state,
    ev(5, {
      type: 'tool.call',
      call: { callId: 'tc1', sessionId: 's1', name: 'bash', args: {}, status: 'success' },
    }),
  );
  state = rootReducer(
    state,
    ev(6, { type: 'message.done', message: { id: 'm-6', role: 'assistant', text: '正在处理', createdAt: 1006 } }),
  );
  return state;
}

describe('buildTrajectory', () => {
  it('groups events by source in time order', () => {
    const state = stateWithMix();
    const items = buildTrajectory(state);
    // user + assistant(merged from deltas) + tool = 3 distinct items
    expect(items.length).toBeGreaterThanOrEqual(3);

    const groups = groupBySource(items);
    const sources = groups.map((g) => g.source);
    expect(sources).toContain('用户输入');
    expect(sources).toContain('模型回复');
    expect(sources).toContain('工具调用');

    const toolGroup = groups.find((g) => g.source === '工具调用');
    expect(toolGroup?.items[0]?.title).toContain('bash');
    expect(toolGroup?.items[0]?.payload).toMatchObject({ status: 'success' });
  });

  it('returns [] for null state and preserves ordering', () => {
    expect(buildTrajectory(null)).toEqual([]);
    const state = stateWithMix();
    const items = buildTrajectory(state);
    const ts = items.map((i) => i.ts);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
});

describe('fixture-driven trajectory', () => {
  it('works with the multiToolRun fixture shape', () => {
    // Build state via a replay of realistic events (mirrors fixtures/multi-tool).
    const events: CkpEvent[] = [
      ev(1, { type: 'session.started', workspace: '/tmp/demo' }),
      ev(2, { type: 'message.user', text: '列出目录' }),
      ev(3, {
        type: 'tool.call',
        call: { callId: 'tc-1', sessionId: 's1', name: 'bash', args: { command: 'ls' }, status: 'running' },
      }),
      ev(4, { type: 'tool.output', callId: 'tc-1', output: 'src\ntest\n' }),
      ev(5, { type: 'tool.done', callId: 'tc-1', status: 'success', durationMs: 10 }),
      ev(6, { type: 'message.delta', text: '完成。' }),
      ev(7, { type: 'message.done', message: { id: 'm-7', role: 'assistant', text: '完成。', createdAt: 1007 } }),
    ];
    const state = reduceEvents(events);
    const items = buildTrajectory(state);
    expect(items.some((i) => i.source === '工具调用' && i.title.includes('bash'))).toBe(true);
    expect(items.some((i) => i.source === '模型回复')).toBe(true);
  });
});
