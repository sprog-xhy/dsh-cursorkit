import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { colors, fonts, radii } from './lib/theme.ts';
import { Button } from './primitives/Button.tsx';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Called after the user clicks 重试 (after the state is reset). */
  onReset?: () => void;
  className?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Class component that catches render errors in its subtree and shows an
 * error card with a 重试 button instead of crashing the app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static override getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Pure presentation: keep a console breadcrumb, no reporting.
    console.error('[ui-kit] ErrorBoundary caught:', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div
        className={this.props.className ? `ck-error-boundary ${this.props.className}` : 'ck-error-boundary'}
        style={{
          border: `1px solid ${colors.redBorder}`,
          borderRadius: radii.lg,
          backgroundColor: colors.redSoft,
          padding: '14px 16px',
          fontFamily: fonts.sans,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13.5, color: colors.redDark }}>界面渲染出错</div>
        <div
          style={{
            marginTop: 6,
            fontSize: 12.5,
            color: colors.redDark,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: fonts.mono,
            maxHeight: 160,
            overflowY: 'auto',
          }}
        >
          {error.message || String(error)}
        </div>
        <div style={{ marginTop: 10 }}>
          <Button variant="secondary" size="sm" onClick={this.handleRetry}>
            重试
          </Button>
        </div>
      </div>
    );
  }
}
