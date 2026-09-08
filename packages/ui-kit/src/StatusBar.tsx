import { colors, fonts } from './lib/theme.ts';
import { formatCompact, formatDurationMs } from './lib/format.ts';

export interface StatusBarProps {
  connected: boolean;
  dshVersion?: string;
  model?: string;
  tokenCount?: { input: number; output: number };
  elapsedMs?: number;
  className?: string;
}

/**
 * Thin bottom status bar: connection dot + dsh version on the left, model +
 * token usage + elapsed time on the right.
 */
export function StatusBar({ connected, dshVersion, model, tokenCount, elapsedMs, className }: StatusBarProps) {
  const elapsed = formatDurationMs(elapsedMs);
  return (
    <div
      className={className ? `ck-statusbar ${className}` : 'ck-statusbar'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '3px 12px',
        backgroundColor: colors.surface,
        borderTop: `1px solid ${colors.border}`,
        fontSize: 11.5,
        color: colors.textSecondary,
        fontFamily: fonts.sans,
        userSelect: 'none',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span
          title={connected ? '已连接' : '未连接'}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: connected ? colors.green : colors.red,
            display: 'inline-block',
          }}
        />
        <span>
          {connected ? 'dsh' : 'dsh 未连接'}
          {connected && dshVersion ? ` v${dshVersion}` : ''}
        </span>
      </span>
      <span style={{ flex: 1 }} />
      {model && <span className="ck-statusbar-model">{model}</span>}
      {tokenCount && (tokenCount.input > 0 || tokenCount.output > 0) && (
        <span className="ck-statusbar-tokens" style={{ fontFamily: fonts.mono, fontSize: 10.5 }}>
          {formatCompact(tokenCount.input)} in / {formatCompact(tokenCount.output)} out
        </span>
      )}
      {elapsed && (
        <span className="ck-statusbar-elapsed" style={{ fontFamily: fonts.mono, fontSize: 10.5 }}>
          {elapsed}
        </span>
      )}
    </div>
  );
}
