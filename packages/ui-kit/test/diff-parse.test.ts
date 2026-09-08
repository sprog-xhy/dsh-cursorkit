import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../src/lib/diff-parse.ts';

describe('parseUnifiedDiff', () => {
  it('parses a single hunk with file headers, +/-/context lines', () => {
    const diff = [
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,4 +1,5 @@',
      ' import { a } from "./a";',
      '-export const x = 1;',
      '+export const x = 2;',
      '+export const y = 3;',
      ' export const z = 4;',
    ].join('\n');

    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(1);

    const h = hunks[0]!;
    expect(h.oldFile).toBe('a/src/app.ts');
    expect(h.newFile).toBe('b/src/app.ts');
    expect(h.oldStart).toBe(1);
    expect(h.oldLines).toBe(4);
    expect(h.newStart).toBe(1);
    expect(h.newLines).toBe(5);
    expect(h.header.startsWith('@@ -1,4 +1,5 @@')).toBe(true);

    expect(h.lines.map((l) => l.kind)).toEqual([
      'context',
      'del',
      'add',
      'add',
      'context',
    ]);
    expect(h.lines[1]!.text).toBe('export const x = 1;');
    expect(h.lines[2]!.text).toBe('export const x = 2;');
  });

  it('parses multiple hunks (same file) preserving order', () => {
    const diff = [
      '--- a/lib.ts',
      '+++ b/lib.ts',
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '+c',
      '@@ -10,1 +10,1 @@',
      '-old',
      '+new',
    ].join('\n');

    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.lines.map((l) => l.kind)).toEqual(['context', 'del', 'add']);
    expect(hunks[1]!.lines.map((l) => l.kind)).toEqual(['del', 'add']);
    expect(hunks[1]!.oldStart).toBe(10);
  });

  it('attaches file headers of each file to its own hunks', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      'index 000..111 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-one',
      '+1',
      'diff --git a/b.ts b/b.ts',
      'index 222..333 100644',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -5 +5 @@',
      '-two',
      '+2',
    ].join('\n');

    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.oldFile).toBe('a/a.ts');
    expect(hunks[0]!.newFile).toBe('b/a.ts');
    expect(hunks[1]!.oldFile).toBe('a/b.ts');
    expect(hunks[1]!.newFile).toBe('b/b.ts');
    // `diff --git` / `index` noise lines are ignored, not body lines.
    expect(hunks[1]!.lines.map((l) => l.kind)).toEqual(['del', 'add']);
  });

  it('handles hunk headers without line counts (defaults to 1)', () => {
    const hunks = parseUnifiedDiff('@@ -3 +4 @@\n-x\n+y\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.oldLines).toBe(1);
    expect(hunks[0]!.newLines).toBe(1);
    expect(hunks[0]!.lines.map((l) => l.kind)).toEqual(['del', 'add']);
  });

  it('is tolerant: no hunks → empty array, no crash on CRLF / trailing newline', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('--- a/x\n+++ b/x\n')).toEqual([]);
    expect(parseUnifiedDiff('not a diff at all\n')).toEqual([]);

    const crlf = '--- a/x.ts\r\n+++ b/x.ts\r\n@@ -1,1 +1,1 @@\r\n-a\r\n+b\r\n';
    const hunks = parseUnifiedDiff(crlf);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines[0]!.text).toBe('a');
  });
});
