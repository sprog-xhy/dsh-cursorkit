/**
 * Git worktree provider (M4 T-050).
 *
 * Real `git worktree` management scoped under a base workspace:
 *   list    → git worktree list
 *   create  → git worktree add <base>/.cursorkit-worktrees/<name> -b <name>
 *   remove  → git worktree remove (safe: rejects dirty worktrees)
 *
 * Pure computation — no ctx access (doc P3).
 *
 * @module @dsh-cursorkit/host-dsh/worktree/git-worktree
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export interface WorktreeEntry {
  name: string;
  path: string;
  branch: string;
}

const WORKTREE_ROOT = '.cursorkit-worktrees';

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

function worktreePath(base: string, name: string): string {
  return join(base, WORKTREE_ROOT, name);
}

/** Whether the base dir is a git repository. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/** List worktrees, mapping names from their basename under the worktree root. */
export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  try {
    const out = await git(cwd, ['worktree', 'list', '--porcelain']);
    const entries: WorktreeEntry[] = [];
    let current: { path?: string; branch?: string } = {};
    const flush = () => {
      if (current.path) {
        const path = current.path;
        const branch = current.branch ?? '';
        // Only report worktrees inside our managed root.
        if (path.includes(WORKTREE_ROOT)) {
          entries.push({ name: path.split('/').pop() ?? '', path, branch });
        }
      }
      current = {};
    };
    for (const line of out.split('\n')) {
      if (line === '') {
        flush();
        continue;
      }
      const [key, ...rest] = line.split(' ');
      if (key === 'worktree') current.path = rest.join(' ');
      else if (key === 'branch') current.branch = rest.join(' ').replace('refs/heads/', '');
    }
    // Final block has no trailing blank line after trim().
    flush();
    return entries;
  } catch {
    return [];
  }
}

/**
 * Create a worktree on a new branch.
 * @returns the entry, or null when the base is not a git repo / branch exists.
 */
export async function createWorktree(cwd: string, name: string, base?: string): Promise<WorktreeEntry | null> {
  try {
    if (!(await isGitRepo(cwd))) return null;
    const path = worktreePath(cwd, name);
    const branch = base ?? name;
    await git(cwd, ['worktree', 'add', '-b', branch, path]);
    return { name, path, branch };
  } catch {
    return null;
  }
}

/** Remove a worktree (refuses when dirty — git does this by default). */
export async function removeWorktree(cwd: string, name: string): Promise<boolean> {
  try {
    const path = worktreePath(cwd, name);
    await git(cwd, ['worktree', 'remove', path]);
    return true;
  } catch {
    return false;
  }
}
