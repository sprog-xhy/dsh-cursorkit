import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../src/rpc/sse.ts';
import { attachAutoCheckpoint } from '../src/checkpoint/auto-checkpoint.ts';
import { listCheckpoints } from '../src/checkpoint/git-checkpoint.ts';

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ckp-auto-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'v1\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

describe('auto-checkpoint', () => {
  it('creates a checkpoint when file.changed arrives', async () => {
    const dir = makeGitRepo();
    try {
      const bus = new EventBus();
      const createdEvents: string[] = [];
      bus.subscribe({ onEvent: (e) => { if (e.type === 'checkpoint.created') createdEvents.push((e as { checkpoint: { id: string } }).checkpoint.id); } });

      attachAutoCheckpoint(bus, (sid) => (sid === 's1' ? dir : undefined), { throttleMs: 0 });

      // Simulate a write: modify the file then emit file.changed.
      writeFileSync(join(dir, 'a.txt'), 'v2\n');
      bus.emit({ sessionId: 's1', type: 'file.changed', change: { path: 'a.txt', patch: 'x', additions: 1, deletions: 0, status: 'pending' } } as never);

      // Wait for the async checkpoint creation.
      await new Promise((r) => setTimeout(r, 300));
      expect(createdEvents.length).toBe(1);
      const list = await listCheckpoints(dir, 's1');
      expect(list.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throttles rapid file.changed events', async () => {
    const dir = makeGitRepo();
    try {
      const bus = new EventBus();
      const createdEvents: string[] = [];
      bus.subscribe({ onEvent: (e) => { if (e.type === 'checkpoint.created') createdEvents.push((e as { checkpoint: { id: string } }).checkpoint.id); } });

      attachAutoCheckpoint(bus, () => dir, { throttleMs: 10_000 });

      // Two rapid writes → only the first should create a checkpoint.
      writeFileSync(join(dir, 'a.txt'), 'v2\n');
      bus.emit({ sessionId: 's1', type: 'file.changed', change: { path: 'a.txt', patch: 'x', additions: 1, deletions: 0, status: 'pending' } } as never);
      writeFileSync(join(dir, 'a.txt'), 'v3\n');
      bus.emit({ sessionId: 's1', type: 'file.changed', change: { path: 'a.txt', patch: 'x', additions: 1, deletions: 0, status: 'pending' } } as never);

      await new Promise((r) => setTimeout(r, 300));
      expect(createdEvents.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores events for sessions without a workspace', async () => {
    const bus = new EventBus();
    const createdEvents: string[] = [];
    bus.subscribe({ onEvent: (e) => { if (e.type === 'checkpoint.created') createdEvents.push('x'); } });
    attachAutoCheckpoint(bus, () => undefined, { throttleMs: 0 });
    bus.emit({ sessionId: 'nope', type: 'file.changed', change: { path: 'a', patch: 'x', additions: 1, deletions: 0, status: 'pending' } } as never);
    await new Promise((r) => setTimeout(r, 100));
    expect(createdEvents.length).toBe(0);
  });
});
