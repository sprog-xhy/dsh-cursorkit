import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Checkpoint } from '@dsh-cursorkit/protocol';
import { colors, fonts } from './lib/theme.ts';
import { formatRelativeTime } from './lib/format.ts';
import { EyeIcon } from './lib/icons.tsx';

export interface CheckpointTimelineProps {
  checkpoints: Checkpoint[];
  /** Restore action (hover-revealed). */
  onRestore?: (id: string) => void;
  /** Preview action (hover-revealed). */
  onPreview?: (id: string) => void;
  className?: string;
}

/**
 * Vertical checkpoint timeline. Each node: colored dot + relative time +
 * summary. Restore/preview buttons appear on hover. Nodes with
 * `reversible === false` are flagged in red (restore is not undoable).
 */
export function CheckpointTimeline({ checkpoints, onRestore, onPreview, className }: CheckpointTimelineProps) {
  return (
    <div
      className={className ? `ck-checkpoints ${className}` : 'ck-checkpoints'}
      style={{ fontFamily: fonts.sans, padding: '4px 0' }}
    >
      {checkpoints.length === 0 && (
        <div style={{ padding: 12, textAlign: 'center', color: colors.textMuted, fontSize: 12.5 }}>暂无检查点</div>
      )}
      {checkpoints.map((cp) => (
        <TimelineNode
          key={cp.id}
          checkpoint={cp}
          onRestore={onRestore}
          onPreview={onPreview}
          isLast={checkpoints[checkpoints.length - 1]?.id === cp.id}
        />
      ))}
    </div>
  );
}

interface NodeProps {
  checkpoint: Checkpoint;
  onRestore?: (id: string) => void;
  onPreview?: (id: string) => void;
  isLast: boolean;
}

function TimelineNode({ checkpoint, onRestore, onPreview, isLast }: NodeProps) {
  const [hover, setHover] = useState(false);
  const irreversible = !checkpoint.reversible;

  return (
    <div
      className="ck-checkpoint-node"
      style={{ display: 'flex', gap: 10, paddingBottom: isLast ? 0 : 12 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          title={irreversible ? '不可逆' : undefined}
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            marginTop: 4,
            backgroundColor: irreversible ? colors.red : colors.blue,
            border: `2px solid ${irreversible ? colors.redSoft : colors.blueSoft}`,
            flexShrink: 0,
          }}
        />
        {!isLast && <div style={{ width: 2, flex: 1, backgroundColor: colors.border, minHeight: 14 }} />}
      </div>

      {/* content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono }}>
            {formatRelativeTime(checkpoint.createdAt)}
          </span>
          {irreversible && (
            <span
              style={{
                fontSize: 10.5,
                color: colors.redDark,
                backgroundColor: colors.redSoft,
                border: `1px solid ${colors.redBorder}`,
                borderRadius: 999,
                padding: '0 6px',
                fontWeight: 500,
              }}
            >
              不可逆
            </span>
          )}
          {checkpoint.commit && (
            <span
              style={{
                fontSize: 10.5,
                color: colors.textMuted,
                fontFamily: fonts.mono,
                backgroundColor: colors.graySoft,
                borderRadius: 4,
                padding: '0 5px',
              }}
            >
              {checkpoint.commit.slice(0, 8)}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.5, wordBreak: 'break-word' }}>
          {checkpoint.summary}
        </div>
        {/* hover-revealed actions */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 3,
            fontSize: 12,
            opacity: hover ? 1 : 0,
            transition: 'opacity 100ms ease',
            height: hover ? 'auto' : 0,
            overflow: 'hidden',
          }}
        >
          {onPreview && (
            <ActionButton onClick={() => onPreview(checkpoint.id)}>
              <EyeIcon size={12} color={colors.blue} /> 预览
            </ActionButton>
          )}
          {onRestore && (
            <ActionButton onClick={() => onRestore(checkpoint.id)} danger={irreversible}>
              {irreversible ? '⚠ 恢复' : '恢复'}
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        border: 'none',
        background: 'none',
        padding: 0,
        fontSize: 12,
        color: danger ? colors.redDark : colors.blue,
        cursor: 'pointer',
        fontFamily: fonts.sans,
      }}
    >
      {children}
    </button>
  );
}
