import type { FileChange } from '@dsh-cursorkit/protocol';
import { colors, fonts, radii } from './lib/theme.ts';
import { FileIcon } from './lib/icons.tsx';
import { Badge } from './primitives/Badge.tsx';

export interface FileChangeListProps {
  changes: FileChange[];
  /** Called when the user clicks 保留 for a pending change. */
  onKeep?: (change: FileChange) => void;
  /** Called when the user clicks 拒绝 for a pending change. */
  onReject?: (change: FileChange) => void;
  className?: string;
}

const statusMeta = {
  pending: { label: '待处理', tone: 'blue' as const },
  kept: { label: '已保留', tone: 'success' as const },
  rejected: { label: '已拒绝', tone: 'neutral' as const },
};

/**
 * List of file changes with per-file keep/reject actions.
 * Rows reflect `status`: pending rows show action buttons; kept/rejected rows
 * are dimmed with a status badge.
 */
export function FileChangeList({ changes, onKeep, onReject, className }: FileChangeListProps) {
  if (changes.length === 0) {
    return (
      <div
        className={className ? `ck-fc-list ${className}` : 'ck-fc-list'}
        style={{ padding: 12, textAlign: 'center', color: colors.textMuted, fontSize: 12.5, fontFamily: fonts.sans }}
      >
        暂无文件变更
      </div>
    );
  }

  return (
    <div
      className={className ? `ck-fc-list ${className}` : 'ck-fc-list'}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        overflow: 'hidden',
        backgroundColor: colors.surface,
        fontFamily: fonts.sans,
      }}
    >
      {changes.map((c, i) => {
        const meta = statusMeta[c.status];
        const pending = c.status === 'pending';
        return (
          <div
            key={c.path}
            className="ck-fc-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderTop: i > 0 ? `1px solid ${colors.border}` : undefined,
              backgroundColor: pending ? colors.surface : '#fafaf9',
              opacity: pending ? 1 : 0.72,
            }}
          >
            <FileIcon size={15} color={pending ? colors.textSecondary : colors.textMuted} />
            <span
              title={c.path}
              style={{
                fontFamily: fonts.mono,
                fontSize: 12.5,
                color: colors.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}
            >
              {c.path}
            </span>
            <span style={{ fontSize: 11.5, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>
              <span style={{ color: colors.green }}>+{c.additions}</span>
              <span style={{ color: colors.textMuted, margin: '0 2px' }}>/</span>
              <span style={{ color: colors.red }}>-{c.deletions}</span>
            </span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {pending && (
              <span style={{ display: 'inline-flex', gap: 6, marginLeft: 4 }}>
                <button
                  type="button"
                  disabled={!onKeep}
                  onClick={() => onKeep?.(c)}
                  title={onKeep ? '保留此变更' : undefined}
                  style={{
                    border: `1px solid ${colors.borderStrong}`,
                    backgroundColor: colors.surface,
                    color: colors.text,
                    borderRadius: 5,
                    padding: '2px 10px',
                    fontSize: 12,
                    cursor: onKeep ? 'pointer' : 'not-allowed',
                    opacity: onKeep ? 1 : 0.5,
                    fontFamily: fonts.sans,
                  }}
                >
                  保留
                </button>
                <button
                  type="button"
                  disabled={!onReject}
                  onClick={() => onReject?.(c)}
                  title={onReject ? '拒绝此变更' : undefined}
                  style={{
                    border: `1px solid ${colors.redBorder}`,
                    backgroundColor: colors.surface,
                    color: colors.redDark,
                    borderRadius: 5,
                    padding: '2px 10px',
                    fontSize: 12,
                    cursor: onReject ? 'pointer' : 'not-allowed',
                    opacity: onReject ? 1 : 0.5,
                    fontFamily: fonts.sans,
                  }}
                >
                  拒绝
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
