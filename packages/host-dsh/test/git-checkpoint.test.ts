import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpoint, listCheckpoints, restoreCheckpoint, countCheckpoints } from '../src/checkpoint/git-checkpoint.ts';

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ckp-chk-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'v1\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

describe('git-checkpoint', () => {
  it('creates a checkpoint commit and lists it', async () => {
    const dir = makeGitRepo();
    try {
      writeFileSync(join(dir, 'a.txt'), 'v2\n');
      const cp = await createCheckpoint({ cwd: dir, sessionId: 's1' }, 'snapshot v2');
      expect(cp).not.toBeNull();
      expect(cp?.reversible).toBe(true);
      expect(cp?.commit).toMatch(/^[0-9a-f]{7,}$/);

      const list = await listCheckpoints(dir, 's1');
      expect(list.length).toBe(1);
      expect(list[0]?.commit).toBe(cp?.commit);
      expect(await countCheckpoints(dir, 's1')).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no changes exist', async () => {
    const dir = makeGitRepo();
    try {
      expect(await createCheckpoint({ cwd: dir, sessionId: 's2' }, 'nothing')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restore checks out a new fork branch without losing history', async () => {
    const dir = makeGitRepo();
    try {
      // change → checkpoint at v2
      writeFileSync(join(dir, 'a.txt'), 'v2\n');
      const cp = await createCheckpoint({ cwd: dir, sessionId: 's3' }, 'v2');
      expect(cp).not.toBeNull();
      // change again → v3 (uncommitted)
      writeFileSync(join(dir, 'a.txt'), 'v3\n');

      const branch = await restoreCheckpoint(dir, `refs/cursorkit/s3/${cp?.id.split('-').pop()}`);
      expect(branch).toMatch(/^cursorkit-restore-/);
      // After checkout, the file should be back at the checkpoint's content.
      const content = execFileSync('git', ['show', 'HEAD:a.txt'], { cwd: dir, encoding: 'utf8' });
      expect(content.trim()).toBe('v2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
