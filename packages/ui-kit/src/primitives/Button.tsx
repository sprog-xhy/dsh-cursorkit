import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { colors, fonts, radii } from '../lib/theme.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  className?: string;
}

const variantStyles: Record<ButtonVariant, CSSProperties> = {
  primary: {
    backgroundColor: colors.blue,
    color: '#fff',
    border: `1px solid ${colors.blueDark}`,
  },
  secondary: {
    backgroundColor: colors.surface,
    color: colors.text,
    border: `1px solid ${colors.borderStrong}`,
  },
  ghost: {
    backgroundColor: 'transparent',
    color: colors.textSecondary,
    border: '1px solid transparent',
  },
  danger: {
    backgroundColor: colors.red,
    color: '#fff',
    border: `1px solid ${colors.redDark}`,
  },
};

const sizeStyles: Record<ButtonSize, CSSProperties> = {
  sm: { padding: '3px 10px', fontSize: 12 },
  md: { padding: '6px 14px', fontSize: 13 },
  lg: { padding: '9px 18px', fontSize: 14 },
};

/**
 * Base button. Pure presentation: all behavior comes from native button
 * attributes (onClick etc.) passed through props.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  children,
  className,
  style,
  disabled,
  ...rest
}: ButtonProps) {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radii.sm,
    fontWeight: 500,
    lineHeight: 1.4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    fontFamily: fonts.sans,
    ...variantStyles[variant],
    ...sizeStyles[size],
    ...style,
  };
  return (
    <button
      type="button"
      className={className ? `ck-btn ${className}` : 'ck-btn'}
      style={base}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
