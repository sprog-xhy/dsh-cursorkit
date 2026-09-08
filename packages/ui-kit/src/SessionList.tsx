import type { Session, SessionStatus } from '@dsh-cursorkit/protocol';
import { colors, fonts, radii } from './lib/theme.ts';
import { formatRelativeTime } from './lib/format.ts';

export interface SessionListProps {
  sessions: Session[];
  activeId?: string;
  onSelect: (id: string) => void;
  className?: string;
}

const statusDot: Record<SessionStatus, string> = {
  idle: colors.gray,
  running: colors.blue,
  'awaiting-approval': colors.amber,
  done: colors.green,
  error: colors.red,
  cancelled: colors.gray,
};

const statusLabel: Record<SessionStatus, string> = {
  idle: '空闲',
  running: '执行中',
  'awaiting-approval': '待审批',
  done: '已完成',
  error: '出错',
  cancelled: '已取消',
};

/**
 * Session list. Each row: status dot + truncated summary + relative time.
 * The active session gets a tinted background and a left accent bar.
 */
export function SessionList({ sessions, activeId, onSelect, className }: SessionListProps) {
  return (
    <div
      className={className ? `ck-session-list ${className}` : 'ck-session-list'}
      style={{ fontFamily: fonts.sans }}
    >
      {sessions.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center', color: colors.textMuted, fontSize: 12.5 }}>暂无会话</div>
      )}
      {sessions.map((s) => {
        const active = s.id === activeId;
        return (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(s.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(s.id);
              }
            }}
            className="ck-session-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px 8px 12px',
              cursor: 'pointer',
              borderRadius: radii.md,
              backgroundColor: active ? colors.blueSoft : 'transparent',
              borderLeft: active ? `3px solid ${colors.blue}` : '3px solid transparent',
              marginBottom: 2,
              transition: 'background-color 100ms ease',
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLDivElement).style.backgroundColor = colors.surfaceHover;
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
            }}
          >
            <span
              title={statusLabel[s.status]}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: statusDot[s.status],
                flexShrink: 0,
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12.5,
                color: active ? colors.blueDark : colors.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: active ? 600 : 400,
              }}
            >
              {s.summary && s.summary.length > 0 ? s.summary : `会话 ${s.id.slice(0, 8)}`}
            </span>
            <span style={{ fontSize: 10.5, color: colors.textMuted, whiteSpace: 'nowrap', fontFamily: fonts.mono }}>
              {formatRelativeTime(s.updatedAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
