import { describe, expect, it } from 'vitest';
import { extractTouchedPath, isWriteTool, inferFileChange } from '../src/bridge/file-change.ts';

describe('file-change inference', () => {
  it('extracts paths from tool args', () => {
    expect(extractTouchedPath('write', { file_path: '/tmp/x.txt' })).toBe('/tmp/x.txt');
    expect(extractTouchedPath('edit', { path: 'src/a.ts' })).toBe('src/a.ts');
    expect(extractTouchedPath('str_replace_editor', { path: '/repo/f.ts' })).toBe('/repo/f.ts');
    expect(extractTouchedPath('bash', { command: 'echo hi > /tmp/out.txt' })).toBe('/tmp/out.txt');
    expect(extractTouchedPath('bash', { command: 'ls' })).toBeUndefined();
    expect(extractTouchedPath('grep', { pattern: 'x' })).toBeUndefined();
  });

  it('classifies write tools', () => {
    expect(isWriteTool('write')).toBe(true);
    expect(isWriteTool('edit')).toBe(true);
    expect(isWriteTool('str_replace_editor')).toBe(true);
    expect(isWriteTool('bash')).toBe(true);
    expect(isWriteTool('grep')).toBe(false);
    expect(isWriteTool('web_search')).toBe(false);
  });

  it('infers a FileChange for a write', () => {
    const fc = inferFileChange('s1', 'write', { file_path: '/tmp/a.txt' }, 'line1\nline2\n');
    expect(fc).toMatchObject({
      path: '/tmp/a.txt',
      additions: 2,
      deletions: 0,
      status: 'pending',
    });
    expect(fc?.patch).toContain('diff --git a//tmp/a.txt b//tmp/a.txt');
  });

  it('returns undefined for read-only tools or missing paths', () => {
    expect(inferFileChange('s1', 'grep', { pattern: 'x' }, 'out')).toBeUndefined();
    expect(inferFileChange('s1', 'bash', { command: 'ls -la' }, 'out')).toBeUndefined();
  });
});
