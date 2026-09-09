import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isGitRepo, listWorktrees, createWorktree, removeWorktree } from '../src/worktree/git-worktree.ts';

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ckp-wt-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'v1\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

describe('git-worktree', () => {
  it('detects git repos', async () => {
    const dir = makeGitRepo();
    const plain = mkdtempSync(join(tmpdir(), 'ckp-wt-plain-'));
    try {
      expect(await isGitRepo(dir)).toBe(true);
      expect(await isGitRepo(plain)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('creates, lists and removes a worktree', async () => {
    const dir = makeGitRepo();
    try {
      const created = await createWorktree(dir, 'feat-x');
      expect(created).not.toBeNull();
      expect(created?.name).toBe('feat-x');
      expect(created?.branch).toBe('feat-x');
      expect(existsSync(created!.path)).toBe(true);

      const list = await listWorktrees(dir);
      expect(list.some((w) => w.name === 'feat-x')).toBe(true);

      expect(await removeWorktree(dir, 'feat-x')).toBe(true);
      expect(existsSync(created!.path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('create returns null for non-git dirs and refuses duplicate branches', async () => {
    const dir = makeGitRepo();
    const plain = mkdtempSync(join(tmpdir(), 'ckp-wt-plain2-'));
    try {
      expect(await createWorktree(plain, 'x')).toBeNull();
      await createWorktree(dir, 'dup');
      expect(await createWorktree(dir, 'dup')).toBeNull(); // branch exists
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
