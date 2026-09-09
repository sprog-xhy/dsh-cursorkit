import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFileChanges, summarizePatch, splitDiffByFile, hasChanges } from '../src/diff/git-diff.ts';

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ckp-git-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

describe('git-diff', () => {
  it('summarizePatch counts additions and deletions', () => {
    const patch = [
      '--- a/x',
      '+++ b/x',
      '@@ -1,2 +1,3 @@',
      ' context',
      '+added1',
      '+added2',
      '-removed',
    ].join('\n');
    expect(summarizePatch(patch)).toEqual({ additions: 2, deletions: 1 });
  });

  it('splitDiffByFile separates multi-file diffs', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      'index abc..def 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n');
    const byFile = splitDiffByFile(diff);
    expect([...byFile.keys()]).toEqual(['a.txt', 'b.txt']);
    expect(byFile.get('a.txt')).toContain('new');
    expect(byFile.get('b.txt')).toContain('y');
  });

  it('computeFileChanges returns modified files with stats', async () => {
    const dir = makeGitRepo();
    try {
      // modify + add a new file
      writeFileSync(join(dir, 'a.txt'), 'hello\nworld\n');
      writeFileSync(join(dir, 'b.txt'), 'brand new\n');
      const changes = await computeFileChanges({ cwd: dir });
      expect(changes.length).toBeGreaterThanOrEqual(2);
      const a = changes.find((c) => c.path === 'a.txt');
      expect(a?.additions).toBe(1); // +world
      const b = changes.find((c) => c.path === 'b.txt');
      expect(b?.additions).toBeGreaterThan(0);
      expect(changes.every((c) => c.status === 'pending')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns [] for non-git directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ckp-nogit-'));
    try {
      mkdirSync(join(dir, 'sub'));
      expect(await computeFileChanges({ cwd: dir })).toEqual([]);
      expect(await hasChanges(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
