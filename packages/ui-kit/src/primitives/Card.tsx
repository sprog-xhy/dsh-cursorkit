import type { CSSProperties, ReactNode } from 'react';
import { colors, fonts, radii } from '../lib/theme.ts';

export interface CardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Padded by default; set false for flush content (e.g. lists). */
  padded?: boolean;
}

/** Generic rounded card container — the base surface of the kit. */
export function Card({ children, className, style, padded = true }: CardProps) {
  return (
    <div
      className={className ? `ck-card ${className}` : 'ck-card'}
      style={{
        backgroundColor: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        padding: padded ? '12px 14px' : 0,
        fontFamily: fonts.sans,
        color: colors.text,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
