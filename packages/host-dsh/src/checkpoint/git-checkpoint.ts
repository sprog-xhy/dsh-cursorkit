/**
 * Checkpoint provider: git-commit-based session checkpoints (M2 T-033).
 *
 * Each checkpoint = a git commit (or stash-like reference) in the session's
 * workspace, stored in a per-session ref namespace so restore never clobbers
 * history (doc §M2-3: restore opens a NEW fork).
 *
 * Pure computation — no ctx access (doc P3).
 *
 * @module @dsh-cursorkit/host-dsh/checkpoint/git-checkpoint
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Checkpoint } from '@dsh-cursorkit/protocol';

const execFileAsync = promisify(execFile);

export interface CheckpointOptions {
  cwd: string;
  sessionId: string;
}

/** Ref namespace for checkpoints of one session: refs/cursorkit/<sessionId>/<n> */
function refFor(sessionId: string, n: number): string {
  return `refs/cursorkit/${sessionId}/${n}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Create a checkpoint: commit all current changes and record the commit under
 * a session-namespaced ref. Returns the Checkpoint or null when the workspace
 * is not a git repo or has no changes.
 */
export async function createCheckpoint(opts: CheckpointOptions, summary: string): Promise<Checkpoint | null> {
  const { cwd, sessionId } = opts;
  try {
    // Ensure a clean base is committable; add everything.
    await git(cwd, ['add', '-A']);
    // Empty repo with no commits: need an initial commit to diff against.
    const hasCommits = (await git(cwd, ['rev-parse', '--verify', 'HEAD'])).length > 0;
    if (!hasCommits) {
      // Nothing to snapshot yet.
      return null;
    }
    const status = await git(cwd, ['status', '--porcelain']);
    if (status.length === 0) {
      return null; // no changes
    }
    await git(cwd, ['commit', '-qm', `cursorkit checkpoint: ${summary.slice(0, 80)}`]);
    const commit = await git(cwd, ['rev-parse', 'HEAD']);

    // Move the session ref forward.
    const n = await nextRefNumber(cwd, sessionId);
    await git(cwd, ['update-ref', refFor(sessionId, n), commit]);

    return {
      id: `${sessionId}-${n}`,
      sessionId,
      summary,
      createdAt: Date.now(),
      commit,
      reversible: true,
    };
  } catch {
    return null;
  }
}

/** Number of existing checkpoints for a session. */
export async function countCheckpoints(cwd: string, sessionId: string): Promise<number> {
  try {
    const out = await git(cwd, ['for-each-ref', '--format=%(refname:short)', `refs/cursorkit/${sessionId}`]);
    return out.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** List checkpoints for a session, newest first. */
export async function listCheckpoints(cwd: string, sessionId: string): Promise<Checkpoint[]> {
  try {
    const out = await git(cwd, ['for-each-ref', '--format=%(refname:short) %(objectname) %(creatordate:unix)', `refs/cursorkit/${sessionId}`]);
    const items = out.split('\n').filter(Boolean).map((line) => {
      const [ref, commit, createdAtRaw] = line.split(' ');
      const refName = ref ?? '';
      const n = Number(refName.split('/').pop() ?? '0');
      return {
        id: `${sessionId}-${n}`,
        sessionId,
        summary: `checkpoint #${n}`,
        createdAt: Number(createdAtRaw ?? 0) * 1000,
        commit,
        reversible: true,
      };
    });
    return items.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/**
 * Restore a checkpoint onto a NEW branch/worktree view (never overwrites
 * history): create a child branch at the checkpoint commit and reset the
 * working tree to it. Returns the branch name.
 */
export async function restoreCheckpoint(cwd: string, checkpointId: string): Promise<string | null> {
  try {
    const branch = `cursorkit-restore-${checkpointId}-${Date.now()}`;
    await git(cwd, ['checkout', '-b', branch, checkpointId]);
    return branch;
  } catch {
    return null;
  }
}

async function nextRefNumber(cwd: string, sessionId: string): Promise<number> {
  const count = await countCheckpoints(cwd, sessionId);
  return count + 1;
}
