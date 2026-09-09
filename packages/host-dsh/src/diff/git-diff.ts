/**
 * Git diff provider: compute FileChange[] for a workspace (M2 T-030).
 *
 * Uses `git` on the PATH. Pure computation — no ctx access (doc P3).
 * Used by the router's `diff.get` and by hooks that emit `file.changed`.
 *
 * @module @dsh-cursorkit/host-dsh/diff/git-diff
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileChange } from '@dsh-cursorkit/protocol';

const execFileAsync = promisify(execFile);

export interface GitDiffOptions {
  /** Workspace directory (git root or a subdir). */
  cwd: string;
  /** Optional path filter (e.g. a specific file). */
  path?: string;
  /** Max files to return (safety). */
  maxFiles?: number;
}

/** Parse a unified diff and count +/- lines. */
export function summarizePatch(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}

/** Split a multi-file `git diff` output into per-file patches. */
export function splitDiffByFile(diff: string): Map<string, string> {
  const files = new Map<string, string>();
  const headerRe = /^diff --git a\/(.+?) b\/(.+?)$/;
  let current: string | null = null;
  const chunks = new Map<string, string[]>();

  for (const line of diff.split('\n')) {
    const m = headerRe.exec(line);
    if (m) {
      current = m[1] ?? m[2] ?? 'unknown';
      chunks.set(current, []);
    }
    if (current) chunks.get(current)!.push(line);
  }
  for (const [file, lines] of chunks) files.set(file, lines.join('\n'));
  return files;
}

/**
 * Compute FileChange[] for a workspace using `git diff` (unstaged + staged)
 * plus untracked files (rendered as additions vs /dev/null).
 * Returns [] when the workspace is not a git repo.
 */
export async function computeFileChanges(opts: GitDiffOptions): Promise<FileChange[]> {
  const { cwd, path, maxFiles = 100 } = opts;

  let combined = '';
  for (const args of [['diff', '--', path].filter(Boolean) as string[], ['diff', '--cached', '--', path].filter(Boolean) as string[]]) {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
      combined += stdout;
    } catch {
      // Not a git repo or git missing — return empty diff.
      return [];
    }
  }

  const byFile = splitDiffByFile(combined);
  const changes: FileChange[] = [];

  // Untracked files: git diff ignores them; render each as a new-file patch.
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, maxBuffer: 10 * 1024 * 1024 });
    for (const rel of stdout.split('\n').filter(Boolean)) {
      if (path && !rel.startsWith(path)) continue;
      if (changes.length >= maxFiles) break;
      try {
        const abs = join(cwd, rel);
        const content = await readFile(abs, 'utf8');
        const lines = content.split('\n');
        changes.push({
          path: rel,
          patch: [
            `diff --git a/${rel} b/${rel}`,
            'new file mode 100644',
            '--- /dev/null',
            `+++ b/${rel}`,
            `@@ -0,0 +1,${lines.length} @@`,
            ...lines.map((l) => `+${l}`),
          ].join('\n'),
          additions: lines.length,
          deletions: 0,
          status: 'pending',
        });
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // ignore ls-files failures
  }

  for (const [file, patch] of byFile) {
    if (changes.length >= maxFiles) break;
    const { additions, deletions } = summarizePatch(patch);
    changes.push({ path: file, patch, additions, deletions, status: 'pending' });
  }
  return changes;
}

/** Whether a workspace has any pending changes (cheap check). */
export async function hasChanges(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd, maxBuffer: 1024 * 1024 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
