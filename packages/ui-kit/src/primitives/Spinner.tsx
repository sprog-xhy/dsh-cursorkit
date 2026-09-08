import type { CSSProperties } from 'react';
import { colors } from '../lib/theme.ts';

export interface SpinnerProps {
  /** Diameter in px. */
  size?: number;
  color?: string;
  /** Thickness of the arc, in px. */
  strokeWidth?: number;
  className?: string;
}

let styleInjected = false;

/** Inject the tiny keyframes once per document (inline styles can't hold @keyframes). */
function ensureSpinnerStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `@keyframes ck-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}

/**
 * CSS-only spinner (border arc + rotation animation).
 */
export function Spinner({ size = 14, color = colors.blue, strokeWidth = 2, className }: SpinnerProps) {
  ensureSpinnerStyle();
  const style: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    border: `${strokeWidth}px solid ${color}33`,
    borderTopColor: color,
    borderRadius: '50%',
    animation: 'ck-spin 700ms linear infinite',
    flexShrink: 0,
  };
  return (
    <span
      className={className ? `ck-spinner ${className}` : 'ck-spinner'}
      role="status"
      aria-label="加载中"
      style={style}
    />
  );
}
