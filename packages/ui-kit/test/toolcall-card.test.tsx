// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ToolCallCard } from '../src/ToolCallCard.tsx';
import type { ToolCall } from '@dsh-cursorkit/protocol';

// vitest runs with `globals: false`, so @testing-library/react's auto-cleanup
// is not registered — clear the DOM between tests explicitly.
afterEach(cleanup);

const baseCall: ToolCall = {
  callId: 'call-1',
  sessionId: 's1',
  name: 'bash',
  args: { command: 'ls -la' },
  status: 'success',
  output: 'total 0\ndrwxr-xr-x',
  exitCode: 0,
  durationMs: 1234,
};

describe('ToolCallCard', () => {
  it('renders without throwing and shows the tool name', () => {
    expect(() => render(<ToolCallCard call={baseCall} />)).not.toThrow();
    expect(screen.getByText('bash')).toBeTruthy();
  });

  it('shows the correct status badge per status', () => {
    const { rerender } = render(<ToolCallCard call={baseCall} />);
    expect(screen.getByText('成功')).toBeTruthy();

    rerender(<ToolCallCard call={{ ...baseCall, status: 'error', error: 'boom' }} />);
    expect(screen.getByText('失败')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();

    rerender(<ToolCallCard call={{ ...baseCall, status: 'running' }} />);
    expect(screen.getByText('执行中')).toBeTruthy();

    rerender(<ToolCallCard call={{ ...baseCall, status: 'denied' }} />);
    expect(screen.getByText('已拒绝')).toBeTruthy();

    rerender(<ToolCallCard call={{ ...baseCall, status: 'pending' }} />);
    expect(screen.getByText('等待中')).toBeTruthy();
  });

  it('formats the duration in the header', () => {
    render(<ToolCallCard call={{ ...baseCall, durationMs: 1234 }} />);
    expect(screen.getByText('1.2s')).toBeTruthy();
  });
});
