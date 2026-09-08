import { useState } from 'react';
import { colors, fonts, radii } from './lib/theme.ts';
import { ChevronIcon } from './lib/icons.tsx';
import { formatDurationMs } from './lib/format.ts';

export interface ThinkingBlockProps {
  /** Chain-of-thought text. */
  text: string;
  /** How long the reasoning took (for the header). */
  durationMs?: number;
  className?: string;
  /** Default expanded (spec: default collapsed — kept as an escape hatch). */
  defaultOpen?: boolean;
}

/**
 * Collapsible chain-of-thought block. Collapsed by default; click the header
 * to expand. Styled as a muted side-note so it reads differently from the
 * assistant's answer.
 */
export function ThinkingBlock({ text, durationMs, className, defaultOpen = false }: ThinkingBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const duration = formatDurationMs(durationMs);

  return (
    <div
      className={className ? `ck-thinking ${className}` : 'ck-thinking'}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        backgroundColor: '#fafaf9',
        marginBottom: 8,
        fontFamily: fonts.sans,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          cursor: 'pointer',
          userSelect: 'none',
          color: colors.textSecondary,
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        <ChevronIcon
          size={12}
          color={colors.textMuted}
          style={{
            transition: 'transform 120ms ease',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            flexShrink: 0,
          }}
        />
        <span style={{ fontStyle: 'italic', letterSpacing: 0.2 }}>思维过程</span>
        {duration && <span style={{ color: colors.textMuted, fontWeight: 400 }}>· {duration}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ color: colors.textMuted, fontWeight: 400 }}>{open ? '收起' : '展开'}</span>
      </div>
      {open && (
        <div
          style={{
            padding: '2px 12px 10px',
            fontSize: 12.5,
            lineHeight: 1.65,
            color: colors.textSecondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 320,
            overflowY: 'auto',
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
