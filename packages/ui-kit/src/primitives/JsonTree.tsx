import { useState } from 'react';
import type { CSSProperties } from 'react';
import { colors, fonts } from '../lib/theme.ts';
import { ChevronIcon } from '../lib/icons.tsx';

export interface JsonTreeProps {
  value: unknown;
  /** Optional root label. */
  name?: string;
  /** Nodes at depth >= maxDepth start collapsed. Default 2. */
  maxDepth?: number;
  className?: string;
}

type JsonKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'object'
  | 'array'
  | 'other';

function kindOf(v: unknown): JsonKind {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'string') return 'string';
  if (t === 'number' || t === 'bigint') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return Array.isArray(v) ? 'array' : 'object';
  return 'other';
}

/** Long leaf strings are truncated for display; full value in `title`. */
const MAX_STRING_CHARS = 500;
const MAX_DEPTH = 64;

const keyStyle: CSSProperties = {
  color: colors.textSecondary,
  fontFamily: fonts.mono,
  fontSize: 12,
  marginRight: 6,
  wordBreak: 'break-all',
};

const rowBase: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  fontFamily: fonts.mono,
  fontSize: 12,
  lineHeight: 1.7,
  minHeight: 21,
};

const leafColor: Record<'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'other', string> = {
  string: colors.greenDark,
  number: colors.blue,
  boolean: colors.amberDark,
  null: colors.textMuted,
  undefined: colors.textMuted,
  other: colors.textMuted,
};

function leafText(v: unknown): { text: string; title?: string } {
  const kind = kindOf(v);
  switch (kind) {
    case 'string': {
      const s = v as string;
      const truncated = s.length > MAX_STRING_CHARS;
      return {
        text: `"${(truncated ? s.slice(0, MAX_STRING_CHARS) : s).replaceAll('\n', '\\n')}"`,
        title: truncated ? s : undefined,
      };
    }
    case 'number':
      return { text: String(v) };
    case 'boolean':
      return { text: String(v) };
    case 'null':
      return { text: 'null' };
    case 'undefined':
      return { text: 'undefined' };
    default:
      return { text: `[${typeof v}]` };
  }
}

interface JsonNodeProps {
  value: unknown;
  keyName?: string;
  depth: number;
  maxDepth: number;
  /** Stable key input from the parent (path + index). */
  k: string;
}

function JsonNode({ value, keyName, depth, maxDepth, k }: JsonNodeProps) {
  const kind = kindOf(value);
  const [expanded, setExpanded] = useState(depth < maxDepth);

  // Depth guard: prevents runaway recursion on exotic/circular payloads.
  if (depth > MAX_DEPTH) {
    return (
      <div style={{ ...rowBase, paddingLeft: depth * 14, color: colors.textMuted }}>
        {keyName !== undefined && <span style={keyStyle}>{keyName}:</span>}
        <span style={{ fontStyle: 'italic' }}>…(过深)</span>
      </div>
    );
  }

  if (kind === 'object' || kind === 'array') {
    const isArray = kind === 'array';
    const obj = value as Record<string, unknown>;
    const keys = isArray ? (value as unknown[]).map((_, i) => String(i)) : Object.keys(obj);
    const countLabel = isArray ? `${keys.length} 项` : `${keys.length} 个键`;
    const openLabel = isArray ? `[ ${countLabel} ]` : `{ ${countLabel} }`;
    const emptyLabel = isArray ? '[ ]' : '{ }';

    if (keys.length === 0) {
      return (
        <div style={{ ...rowBase, paddingLeft: depth * 14 }}>
          {keyName !== undefined && <span style={keyStyle}>{keyName}:</span>}
          <span style={{ color: colors.textMuted }}>{emptyLabel}</span>
        </div>
      );
    }

    return (
      <div>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          style={{ ...rowBase, paddingLeft: depth * 14, cursor: 'pointer' }}
          onClick={() => setExpanded((e) => !e)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded((x) => !x);
            }
          }}
        >
          <ChevronIcon
            size={11}
            color={colors.textMuted}
            style={{
              alignSelf: 'center',
              transition: 'transform 120ms ease',
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              flexShrink: 0,
            }}
          />
          {keyName !== undefined && <span style={keyStyle}>{keyName}:</span>}
          <span style={{ color: colors.textSecondary }}>{openLabel}</span>
        </div>
        {expanded && (
          <div>
            {keys.map((kName, i) => (
              <JsonNode
                key={`${k}:${i}`}
                k={`${k}:${i}`}
                value={obj[kName]}
                keyName={kName}
                depth={depth + 1}
                maxDepth={maxDepth}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const leaf = leafText(value);
  return (
    <div style={{ ...rowBase, paddingLeft: depth * 14 }}>
      {keyName !== undefined && <span style={keyStyle}>{keyName}:</span>}
      <span
        title={leaf.title}
        style={{
          color: leafColor[kind],
          fontStyle: kind === 'null' || kind === 'undefined' || kind === 'other' ? 'italic' : undefined,
          wordBreak: 'break-all',
        }}
      >
        {leaf.text}
      </span>
    </div>
  );
}

/**
 * Recursive JSON value tree. Objects/arrays are collapsible; leaves render
 * color-coded by type. Pure presentation.
 */
export function JsonTree({ value, name, maxDepth = 2, className }: JsonTreeProps) {
  return (
    <div
      className={className ? `ck-jsontree ${className}` : 'ck-jsontree'}
      style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.text }}
    >
      <JsonNode value={value} keyName={name} depth={0} maxDepth={maxDepth} k="root" />
    </div>
  );
}
