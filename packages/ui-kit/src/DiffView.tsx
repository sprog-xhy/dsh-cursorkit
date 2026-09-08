import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, fonts, radii } from './lib/theme.ts';
import { parseUnifiedDiff } from './lib/diff-parse.ts';
import type { DiffHunk, DiffLine } from './lib/diff-parse.ts';

export interface DiffViewProps {
  /** Unified diff text. */
  diff: string;
  mode?: 'unified' | 'split';
  /** Diff renders truncated beyond this many lines ("展开全部" reveals). */
  maxLines?: number;
  className?: string;
}

const DEFAULT_MAX_LINES = 300;

/**
 * Read-only unified-diff renderer. `+` lines green, `-` lines red, `@@`
 * headers blue, context neutral. Large diffs are truncated with an expand
 * control. `split` mode renders the same hunks in two columns
 * (left = removed, right = added).
 */
export function DiffView({ diff, mode = 'unified', maxLines = DEFAULT_MAX_LINES, className }: DiffViewProps) {
  const hunks = parseUnifiedDiff(diff);
  const [expanded, setExpanded] = useState(false);

  // Truncation works on rendered lines: file headers + hunk headers + body.
  const flat = flatten(hunks);
  const total = flat.length;
  const truncated = total > maxLines && !expanded;
  const shown = truncated ? flat.slice(0, maxLines) : flat;

  if (hunks.length === 0) {
    // Not a parseable unified diff — show raw text.
    return (
      <pre
        className={className ? `ck-diff ${className}` : 'ck-diff'}
        style={{
          margin: 0,
          padding: 8,
          backgroundColor: '#fafaf9',
          border: `1px solid ${colors.border}`,
          borderRadius: radii.md,
          fontSize: 12,
          lineHeight: 1.55,
          fontFamily: fonts.mono,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 320,
          overflowY: 'auto',
        }}
      >
        {diff}
      </pre>
    );
  }

  return (
    <div
      className={className ? `ck-diff ${className}` : 'ck-diff'}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: radii.md,
        overflow: 'hidden',
        backgroundColor: colors.surface,
        fontSize: 12,
        fontFamily: fonts.mono,
        lineHeight: 1.55,
      }}
    >
      <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
        {mode === 'split' ? (
          <SplitTable rows={shown} />
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {shown.map((row, i) => (
                <tr key={i} style={{ ...rowBg(row), display: 'block' }}>
                  <td style={{ ...cell, color: rowColor(row) }}>{row.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {truncated && (
        <div style={{ padding: 6, borderTop: `1px solid ${colors.border}`, textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              border: 'none',
              background: 'none',
              color: colors.blue,
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: fonts.sans,
            }}
          >
            展开全部（共 {total} 行）
          </button>
        </div>
      )}
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */

interface Row {
  kind: 'file' | 'hunk' | DiffLine['kind'];
  text: string;
}

function flatten(hunks: DiffHunk[]): Row[] {
  const rows: Row[] = [];
  let lastOld: string | undefined;
  let lastNew: string | undefined;
  for (const h of hunks) {
    if (h.oldFile !== lastOld || h.newFile !== lastNew) {
      if (h.oldFile !== undefined) rows.push({ kind: 'file', text: `--- ${h.oldFile}` });
      if (h.newFile !== undefined) rows.push({ kind: 'file', text: `+++ ${h.newFile}` });
      lastOld = h.oldFile;
      lastNew = h.newFile;
    }
    rows.push({ kind: 'hunk', text: h.header });
    for (const l of h.lines) rows.push({ kind: l.kind, text: l.text });
  }
  return rows;
}

const cell: CSSProperties = {
  padding: '0 10px',
  whiteSpace: 'pre',
  verticalAlign: 'top',
};

function rowColor(row: Row): string {
  switch (row.kind) {
    case 'add':
      return colors.greenDark;
    case 'del':
      return colors.redDark;
    case 'hunk':
      return colors.blue;
    case 'file':
      return colors.textSecondary;
    default:
      return colors.text;
  }
}

function rowBg(row: Row): CSSProperties {
  switch (row.kind) {
    case 'add':
      return { backgroundColor: colors.greenSoft };
    case 'del':
      return { backgroundColor: colors.redSoft };
    case 'hunk':
      return { backgroundColor: colors.blueSoft };
    case 'file':
      return { backgroundColor: '#fafaf9' };
    default:
      return { backgroundColor: colors.surface };
  }
}

function SplitTable({ rows }: { rows: Row[] }) {
  // Left column shows del + context, right shows add + context; meta spans.
  const left: Array<{ kind: Row['kind']; text: string; span: boolean }> = [];
  const right: Array<{ kind: Row['kind']; text: string; span: boolean }> = [];

  for (const row of rows) {
    if (row.kind === 'add') {
      right.push({ kind: 'add', text: row.text, span: false });
    } else if (row.kind === 'del') {
      left.push({ kind: 'del', text: row.text, span: false });
    } else if (row.kind === 'context') {
      left.push({ kind: 'context', text: row.text, span: false });
      right.push({ kind: 'context', text: row.text, span: false });
    } else {
      left.push({ kind: row.kind, text: row.text, span: true });
      right.push({ kind: row.kind, text: row.text, span: true });
    }
  }

  const n = Math.max(left.length, right.length);
  const rowsOut: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    if (l?.span || r?.span) {
      const row = l ?? r;
      rowsOut.push(
        <tr key={i} style={{ ...rowBg(row), display: 'flex' }}>
          <td colSpan={2} style={{ ...cell, color: rowColor(row), flex: 1 }}>
            {row.text}
          </td>
        </tr>,
      );
      continue;
    }
    rowsOut.push(
      <tr key={i} style={{ display: 'flex' }}>
        <td style={{ ...cell, ...rowBg(l), color: l ? rowColor(l) : colors.textMuted, flex: 1, minWidth: 0 }}>
          {l ? l.text : ''}
        </td>
        <td style={{ ...cell, ...rowBg(r), color: r ? rowColor(r) : colors.textMuted, flex: 1, minWidth: 0 }}>
          {r ? r.text : ''}
        </td>
      </tr>,
    );
  }
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <tbody>{rowsOut}</tbody>
    </table>
  );
}
