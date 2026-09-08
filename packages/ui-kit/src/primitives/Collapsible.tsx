import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, fonts, radii } from '../lib/theme.ts';
import { ChevronIcon } from '../lib/icons.tsx';

export interface CollapsibleProps {
  /** Header content (left side, next to the chevron). */
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state (overrides internal state when provided). */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** Max height of the body when open (scrolls beyond). */
  maxHeight?: string;
  /** Extra content pinned to the right side of the header. */
  right?: ReactNode;
  /** Compact variant (denser padding, used inside cards). */
  compact?: boolean;
  className?: string;
}

/**
 * Collapsible section: header row (title + chevron + optional right slot)
 * with an expandable body. Pure presentation — internal open state only.
 */
export function Collapsible({
  title,
  children,
  defaultOpen = false,
  open: openProp,
  onToggle,
  maxHeight,
  right,
  compact = false,
  className,
}: CollapsibleProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp !== undefined ? openProp : openState;

  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setOpenState(next);
    onToggle?.(next);
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: compact ? '4px 6px' : '6px 8px',
    borderRadius: radii.sm,
    cursor: 'pointer',
    userSelect: 'none',
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.sans,
    fontWeight: 500,
  };

  return (
    <div className={className ? `ck-collapsible ${className}` : 'ck-collapsible'}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        style={headerStyle}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
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
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ flex: 1 }} />
        {right}
      </div>
      {open && (
        <div
          style={{
            maxHeight,
            overflowY: maxHeight ? 'auto' : undefined,
            padding: compact ? '0 6px 6px' : '2px 8px 8px',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
