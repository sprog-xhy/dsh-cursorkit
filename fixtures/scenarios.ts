/**
 * Fixtures: CKP event streams for reducer tests and UI development.
 * Three scenarios (doc §12): simple Q&A / multi-tool-call / approval+error.
 *
 * @module fixtures
 */

import type { CkpEvent } from '@dsh-cursorkit/protocol';

let seqCounter = 0;
/** Loose event input (CkpEvent minus seq/ts/sessionId); cast on build. */
type RawEvent = { sessionId?: string; type: string; [key: string]: unknown };
function ev(partial: RawEvent, tsOffset = 1000): CkpEvent {
  return {
    seq: ++seqCounter,
    ts: 1_700_000_000_000 + tsOffset,
    sessionId: partial.sessionId ?? 's1',
    ...partial,
  } as unknown as CkpEvent;
}

/** Scenario 1: simple Q&A with streaming. */
export function simpleQa(): CkpEvent[] {
  seqCounter = 0;
  return [
    ev({ type: 'session.started', workspace: '/tmp/demo', model: 'deepseek-chat' }),
    ev({ type: 'message.user', text: '你好，介绍一下你自己' }),
    ev({ type: 'thinking.delta', text: '用户想了解我的能力' }),
    ev({ type: 'thinking.delta', text: '简要回答即可' }),
    ev({ type: 'thinking.done', text: '' }),
    ev({ type: 'message.delta', text: '你好！我是' }),
    ev({ type: 'message.delta', text: ' dsh-cursorkit，一个运行在' }),
    ev({ type: 'message.delta', text: ' DeepSeek Harness 之上的桌面客户端。' }),
    ev({
      type: 'message.done',
      message: { id: 'm-assistant-1', role: 'assistant', text: '你好！我是 dsh-cursorkit，一个运行在 DeepSeek Harness 之上的桌面客户端。', createdAt: 1_700_000_000_100 },
    }),
    ev({ type: 'done', status: 'done' }),
  ];
}

/** Scenario 2: multi-tool-call agent run. */
export function multiToolRun(): CkpEvent[] {
  seqCounter = 0;
  return [
    ev({ type: 'session.started', workspace: '/tmp/demo' }),
    ev({ type: 'message.user', text: '列出当前目录并统计行数' }),
    ev({
      type: 'tool.call',
      call: { callId: 'tc-1', sessionId: 's1', name: 'bash', args: { command: 'ls -la' }, status: 'running', startedAt: 1_700_000_000_050 },
    }),
    ev({ type: 'tool.output', callId: 'tc-1', output: 'total 12\ndrwxr-xr-x  src\ndrwxr-xr-x  test\n-rw-r--r--  package.json\n' }),
    ev({ type: 'tool.done', callId: 'tc-1', status: 'success', durationMs: 320 }),
    ev({
      type: 'tool.call',
      call: { callId: 'tc-2', sessionId: 's1', name: 'grep', args: { pattern: 'export', path: 'src' }, status: 'running', startedAt: 1_700_000_000_380 },
    }),
    ev({ type: 'tool.output', callId: 'tc-2', output: 'src/index.ts:1: export class CkpClient\nsrc/store.ts:3: export const createStore\n' }),
    ev({ type: 'tool.done', callId: 'tc-2', status: 'success', durationMs: 45 }),
    ev({ type: 'message.delta', text: '当前目录下有两个子目录' }),
    ev({ type: 'message.delta', text: '（src、test），导出点共 2 处。' }),
    ev({
      type: 'message.done',
      message: { id: 'm-2', role: 'assistant', text: '当前目录下有两个子目录（src、test），导出点共 2 处。', createdAt: 1_700_000_000_450 },
    }),
    ev({ type: 'done', status: 'done' }),
  ];
}

/** Scenario 3: approval + error + checkpoint. */
export function approvalAndError(): CkpEvent[] {
  seqCounter = 0;
  return [
    ev({ type: 'session.started', workspace: '/tmp/demo' }),
    ev({ type: 'message.user', text: '帮我删除构建产物目录' }),
    ev({
      type: 'tool.call',
      call: { callId: 'tc-1', sessionId: 's1', name: 'bash', args: { command: 'rm -rf node_modules' }, status: 'running', startedAt: 1_700_000_000_050 },
    }),
    ev({
      type: 'approval.request',
      approval: { id: 'appr-1', sessionId: 's1', tool: 'bash', args: { command: 'rm -rf node_modules' }, reason: '删除目录需要确认', expiresAt: 1_700_000_000_350, risks: ['shell', 'write'] },
    }),
    ev({ type: 'approval.resolved', approvalId: 'appr-1', decision: 'once' }),
    ev({ type: 'tool.output', callId: 'tc-1', output: 'removed node_modules\n' }),
    ev({ type: 'tool.done', callId: 'tc-1', status: 'success', durationMs: 1200 }),
    ev({
      type: 'checkpoint.created',
      checkpoint: { id: 'cp-1', sessionId: 's1', summary: 'before cleanup', createdAt: 1_700_000_000_200, reversible: true },
    }),
    ev({
      type: 'tool.call',
      call: { callId: 'tc-2', sessionId: 's1', name: 'npm', args: { command: 'npm install' }, status: 'running', startedAt: 1_700_000_000_600 },
    }),
    ev({ type: 'tool.output', callId: 'tc-2', output: 'npm ERR! network timeout\n' }),
    ev({ type: 'tool.done', callId: 'tc-2', status: 'error', durationMs: 30000, error: 'network timeout' }),
    ev({ type: 'error', message: 'npm install 失败：网络超时' }),
  ];
}

/** All scenarios keyed by name. */
export const scenarios: Record<string, () => CkpEvent[]> = {
  'simple-qa': simpleQa,
  'multi-tool': multiToolRun,
  'approval-error': approvalAndError,
};
