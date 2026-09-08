import { describe, expect, it } from 'vitest';
import { rootReducer, reduceEvents, initialState } from '../src/store/index.ts';
import { makeLocalMessage } from '../src/optimistic.ts';
import type { CkpEvent } from '@dsh-cursorkit/protocol';

function ev(seq: number, e: Omit<CkpEvent, 'seq' | 'ts' | 'sessionId'> & { sessionId?: string }): CkpEvent {
  return { seq, ts: 1000 + seq, sessionId: e.sessionId ?? 's1', ...e } as unknown as CkpEvent;
}

describe('rootReducer', () => {
  it('applies a full conversation sequence', () => {
    let state = initialState();
    state = rootReducer(state, ev(1, { type: 'session.started', workspace: '/tmp', model: 'deepseek' }));
    expect(state.meta?.workspace).toBe('/tmp');
    expect(state.status).toBe('running');

    state = rootReducer(state, ev(2, { type: 'message.user', text: 'hello' }));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'user', text: 'hello' });

    state = rootReducer(state, ev(3, { type: 'message.delta', text: 'Hi' }));
    state = rootReducer(state, ev(4, { type: 'message.delta', text: ' there' }));
    expect(state.messages[1]).toMatchObject({ role: 'assistant', text: 'Hi there', pending: true });

    state = rootReducer(
      state,
      ev(5, {
        type: 'message.done',
        message: { id: 'm-5', role: 'assistant', text: 'Hi there', createdAt: 1005 },
      }),
    );
    expect(state.messages[1]).toMatchObject({ text: 'Hi there', pending: false });

    state = rootReducer(
      state,
      ev(6, {
        type: 'tool.call',
        call: { callId: 'tc1', sessionId: 's1', name: 'bash', args: { command: 'ls' }, status: 'running' },
      }),
    );
    expect(state.toolCalls['tc1']?.status).toBe('running');

    state = rootReducer(state, ev(7, { type: 'tool.output', callId: 'tc1', output: 'file1\nfile2\n' }));
    expect(state.toolCalls['tc1']?.output).toBe('file1\nfile2\n');

    state = rootReducer(state, ev(8, { type: 'tool.done', callId: 'tc1', status: 'success', durationMs: 12 }));
    expect(state.toolCalls['tc1']).toMatchObject({ status: 'success', durationMs: 12 });

    state = rootReducer(
      state,
      ev(9, {
        type: 'approval.request',
        approval: {
          id: 'a1',
          sessionId: 's1',
          tool: 'bash',
          args: {},
          expiresAt: 1000 + 300_000,
          risks: ['shell'],
        },
      }),
    );
    expect(state.status).toBe('awaiting-approval');

    state = rootReducer(state, ev(10, { type: 'approval.resolved', approvalId: 'a1', decision: 'once' }));
    expect(state.approvals).toHaveLength(0);
    expect(state.approvalDecisions['a1']).toBe('once');
    expect(state.status).toBe('running');

    state = rootReducer(state, ev(11, { type: 'done', status: 'done' }));
    expect(state.status).toBe('done');
    expect(state.lastSeq).toBe(11);
  });

  it('merges thinking deltas into one block and closes it', () => {
    let state = initialState();
    state = rootReducer(state, ev(1, { type: 'thinking.delta', text: 'step 1 ' }));
    state = rootReducer(state, ev(2, { type: 'thinking.delta', text: 'step 2' }));
    expect(state.thinking).toHaveLength(1);
    expect(state.thinking[0]?.text).toBe('step 1 step 2');
    state = rootReducer(state, ev(3, { type: 'thinking.done', text: '' }));
    expect(state.thinking[0]?.done).toBe(true);
  });

  it('appends file changes and checkpoints', () => {
    let state = initialState();
    state = rootReducer(
      state,
      ev(1, {
        type: 'file.changed',
        change: { path: 'a.txt', patch: '---\n+++', additions: 1, deletions: 0, status: 'pending' },
      }),
    );
    state = rootReducer(
      state,
      ev(2, { type: 'checkpoint.created', checkpoint: { id: 'cp1', sessionId: 's1', summary: 'wip', createdAt: 1002, reversible: true } }),
    );
    expect(state.fileChanges).toHaveLength(1);
    expect(state.checkpoints).toHaveLength(1);
  });

  it('handles error and cancelled', () => {
    expect(rootReducer(initialState(), ev(1, { type: 'error', message: 'boom' })).status).toBe('error');
    expect(rootReducer(initialState(), ev(1, { type: 'cancelled' })).status).toBe('cancelled');
  });
});

describe('reduceEvents', () => {
  it('replays a log deterministically', () => {
    const log = [
      ev(1, { type: 'session.started', workspace: '/w' }),
      ev(2, { type: 'message.user', text: 'q' }),
      ev(3, { type: 'message.delta', text: 'a' }),
      ev(4, { type: 'done', status: 'done' }),
    ];
    const state = reduceEvents(log);
    expect(state.messages).toHaveLength(2);
    expect(state.status).toBe('done');
    expect(state.lastSeq).toBe(4);
    // Deterministic: replaying the same log yields an equal state.
    expect(reduceEvents(log)).toEqual(state);
  });
});

describe('optimistic local messages', () => {
  it('applies a local message immediately with pending flag', () => {
    const local = makeLocalMessage('s1', 'optimistic!');
    const state = rootReducer(initialState(), local);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'user', text: 'optimistic!', pending: true });
  });
});
