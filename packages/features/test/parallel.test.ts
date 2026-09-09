import { describe, expect, it, vi } from 'vitest';
import { spawnParallel } from '../src/sessions/parallel/ParallelView.tsx';

function fakeClient(ids: string[]) {
  const created: string[] = [];
  return {
    sessionCreate: vi.fn(async () => {
      const id = ids[created.length] ?? `s-${created.length + 1}`;
      created.push(id);
      return { id };
    }),
    sessionSend: vi.fn(async () => ({ messageId: 'm1' })),
    _created: created,
  };
}

describe('spawnParallel', () => {
  it('creates n sessions and sends the prompt to each', async () => {
    const client = fakeClient([]) as unknown as Parameters<typeof spawnParallel>[0];
    const ids = await spawnParallel(client, '/tmp/w', 'solve it', 3);
    expect(ids.length).toBe(3);
    expect(client.sessionCreate).toHaveBeenCalledTimes(3);
    expect(client.sessionSend).toHaveBeenCalledTimes(3);
    for (const call of (client.sessionSend as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toBe('solve it');
    }
  });

  it('handles n=1 and distinct ids', async () => {
    const client = fakeClient(['a', 'b']) as unknown as Parameters<typeof spawnParallel>[0];
    const ids = await spawnParallel(client, '/tmp/w', 'p', 2);
    expect(ids).toEqual(['a', 'b']);
  });
});
