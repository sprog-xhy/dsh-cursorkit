/**
 * File-change inference: translate dsh tool activity into CKP `file.changed`
 * events (M2 T-030 second half).
 *
 * dsh does not emit a dedicated file-change event; we infer it from the
 * tool/result stream: when a write-capable tool (bash heredoc, edit, write,
 * str_replace_editor) reports a touched path, emit a CKP file.changed with a
 * best-effort patch (or a marker patch when the diff is unavailable).
 *
 * Pure computation — no ctx access (doc P3).
 *
 * @module @dsh-cursorkit/host-dsh/bridge/file-change
 */

import type { FileChange } from '@dsh-cursorkit/protocol';

/** Tool names / argument keys that indicate a file was written. */
const WRITE_TOOL_RE = /^(write|edit|str_replace_editor|apply_patch|create|overwrite|touch|mkdir|rm|mv|cp)$/i;
const PATH_ARG_KEYS = ['path', 'file_path', 'filepath', 'file', 'filename', 'target', 'dest'];

/** Try to extract a file path from a tool call's arguments. */
export function extractTouchedPath(toolName: string, args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const obj = args as Record<string, unknown>;
  for (const key of PATH_ARG_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  // bash: try to find a redirect target in the command.
  if (/^bash$/i.test(toolName) && typeof obj['command'] === 'string') {
    const m = /[>»][\s]*["']?([^"'\s>]+)["']?/.exec(obj['command']);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Whether a tool is write-capable. */
export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_RE.test(toolName) || /^(bash|sh|shell)$/i.test(toolName);
}

/**
 * Build a FileChange from an inferred write. `patch` is best-effort:
 * consumers may re-run diff.get for the authoritative unified diff.
 */
export function inferFileChange(
  sessionId: string,
  toolName: string,
  args: unknown,
  output: string,
): FileChange | undefined {
  const path = extractTouchedPath(toolName, args);
  if (!path || !isWriteTool(toolName)) return undefined;

  const additions = countAddedLines(output);
  return {
    path,
    patch: markerPatch(path, toolName, additions),
    additions,
    deletions: 0,
    status: 'pending',
  };
}

/** A stable marker patch when the real diff is unknown (authoritative diff via diff.get). */
function markerPatch(path: string, toolName: string, additions: number): string {
  return [
    `# file.changed (inferred from tool "${toolName}")`,
    `# ${additions} line(s) added — run diff.get for the authoritative unified diff`,
    `diff --git a/${path} b/${path}`,
  ].join('\n');
}

function countAddedLines(output: string): number {
  if (!output) return 0;
  // Heuristic: non-empty output lines that look like written content.
  const lines = output.split('\n').filter((l) => l.trim().length > 0);
  return Math.min(lines.length, 1000);
}
