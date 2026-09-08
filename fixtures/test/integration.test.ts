import { describe, expect, it } from 'vitest';
import { simpleQa, multiToolRun, approvalAndError } from '../scenarios.ts';
import { reduceEvents, initialState } from '@dsh-cursorkit/client';

describe('fixture integration with client store', () => {
  it('simple-qa replays to a done state with 2 messages', () => {
    const state = reduceEvents(simpleQa());
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.text).toContain('桌面客户端');
    expect(state.status).toBe('done');
    expect(state.lastSeq).toBe(10);
  });

  it('multi-tool replays tool calls and streamed text', () => {
    const state = reduceEvents(multiToolRun());
    expect(Object.keys(state.toolCalls)).toHaveLength(2);
    expect(state.toolCalls['tc-1']?.output).toContain('package.json');
    expect(state.toolCalls['tc-2']?.status).toBe('success');
    expect(state.messages.at(-1)?.text).toContain('导出点共 2 处');
  });

  it('approval-error replays approval flow and ends in error', () => {
    const state = reduceEvents(approvalAndError());
    expect(state.approvals).toHaveLength(0);
    expect(state.approvalDecisions['appr-1']).toBe('once');
    expect(state.checkpoints).toHaveLength(1);
    expect(state.toolCalls['tc-2']?.status).toBe('error');
    expect(state.status).toBe('error');
  });

  it('is deterministic across replays', () => {
    expect(reduceEvents(simpleQa())).toEqual(reduceEvents(simpleQa()));
    const fromScratch = reduceEvents(multiToolRun());
    expect(reduceEvents(multiToolRun())).toEqual(fromScratch);
  });

  it('initial state is clean', () => {
    expect(initialState().messages).toEqual([]);
  });
});
