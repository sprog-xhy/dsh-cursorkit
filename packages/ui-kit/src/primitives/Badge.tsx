import type { ReactNode } from 'react';
import { colors, fonts, radii } from '../lib/theme.ts';

export type BadgeTone = 'neutral' | 'success' | 'error' | 'warning' | 'blue';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  /** Optional title attribute (e.g. full text on truncation). */
  title?: string;
}

const toneStyles: Record<BadgeTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: colors.graySoft, fg: colors.textSecondary, border: colors.grayBorder },
  success: { bg: colors.greenSoft, fg: colors.greenDark, border: colors.greenBorder },
  error: { bg: colors.redSoft, fg: colors.redDark, border: colors.redBorder },
  warning: { bg: colors.amberSoft, fg: colors.amberDark, border: colors.amberBorder },
  blue: { bg: colors.blueSoft, fg: colors.blueDark, border: colors.blueBorder },
};

/** Small rounded status pill. */
export function Badge({ tone = 'neutral', children, className, title }: BadgeProps) {
  const t = toneStyles[tone];
  return (
    <span
      className={className ? `ck-badge ${className}` : 'ck-badge'}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 8px',
        borderRadius: 999,
        backgroundColor: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
        fontFamily: fonts.sans,
      }}
    >
      {children}
    </span>
  );
}
