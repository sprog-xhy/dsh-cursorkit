import type { ApprovalDecision, ApprovalRequest, ApprovalRisk } from '@dsh-cursorkit/protocol';
import { colors, fonts, radii } from './lib/theme.ts';
import { formatCountdown } from './lib/format.ts';
import { ShieldIcon } from './lib/icons.tsx';
import { Badge } from './primitives/Badge.tsx';
import type { BadgeTone } from './primitives/Badge.tsx';
import { Button } from './primitives/Button.tsx';
import { Card } from './primitives/Card.tsx';
import { Collapsible } from './primitives/Collapsible.tsx';
import { JsonTree } from './primitives/JsonTree.tsx';

export interface ApprovalCardProps {
  approval: ApprovalRequest;
  onRespond: (decision: ApprovalDecision) => void;
  /** Milliseconds remaining (drives the countdown bar/text). */
  countdownMs?: number;
  className?: string;
}

/** Risk category → display label + badge tone (spec §8.1: write/shell/network). */
const riskMeta: Record<ApprovalRisk, { label: string; tone: BadgeTone }> = {
  write: { label: '写文件', tone: 'warning' },
  shell: { label: '执行命令', tone: 'error' },
  network: { label: '网络', tone: 'blue' },
  other: { label: '其他', tone: 'neutral' },
};

// Default approval window (host creates PendingApproval with 5 min, docs §9.4).
// Used only to scale the countdown bar when `countdownMs` is provided.
const DEFAULT_APPROVAL_WINDOW_MS = 5 * 60 * 1000;

/**
 * Approval card — the visible boundary of the permission system.
 * Shows risk badges, a tool + args preview and the four decision buttons
 * (允许一次 / 本次会话 / 总是允许 / 拒绝). Never collapses to a single Allow.
 */
export function ApprovalCard({ approval, onRespond, countdownMs, className }: ApprovalCardProps) {
  const hasCountdown = countdownMs !== undefined && countdownMs >= 0;
  const ratio = hasCountdown ? Math.min(1, countdownMs / DEFAULT_APPROVAL_WINDOW_MS) : 0;
  const expired = hasCountdown && countdownMs <= 0;

  return (
    <Card
      className={className ? `ck-approval ${className}` : 'ck-approval'}
      style={{
        borderColor: colors.amberBorder,
        boxShadow: 'none',
        marginBottom: 8,
      }}
    >
      {/* ── Top: shield + title + risk badges ─────────────────── */}
      <div
        className="ck-approval-header"
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
      >
        <ShieldIcon size={18} color={colors.amber} />
        <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>需要授权</span>
        <span style={{ flex: 1 }} />
        {approval.risks.map((r) => (
          <Badge key={r} tone={riskMeta[r].tone}>
            {riskMeta[r].label}
          </Badge>
        ))}
      </div>

      {approval.reason && (
        <div
          style={{
            marginTop: 6,
            fontSize: 12.5,
            color: colors.textSecondary,
            lineHeight: 1.55,
          }}
        >
          {approval.reason}
        </div>
      )}

      {/* ── Middle: tool + args preview ───────────────────────── */}
      <div
        className="ck-approval-preview"
        style={{
          marginTop: 8,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.md,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '6px 10px',
            backgroundColor: '#fafaf9',
            fontFamily: fonts.mono,
            fontSize: 12.5,
            fontWeight: 600,
            color: colors.text,
            borderBottom: `1px solid ${colors.border}`,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {approval.tool}
        </div>
        <Collapsible className="ck-approval-args" title="参数预览" compact>
          <JsonTree value={approval.args} maxDepth={1} />
        </Collapsible>
      </div>

      {/* ── Countdown ─────────────────────────────────────────── */}
      {hasCountdown && (
        <div className="ck-approval-countdown" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: colors.textMuted, marginBottom: 3 }}>
            <span>{expired ? '已超时，将自动拒绝' : '倒计时'}</span>
            <span style={{ fontFamily: fonts.mono }}>{formatCountdown(countdownMs)}</span>
          </div>
          <div
            style={{
              height: 3,
              borderRadius: 2,
              backgroundColor: colors.graySoft,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${ratio * 100}%`,
                backgroundColor: expired ? colors.red : colors.amber,
                transition: 'width 500ms linear',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Bottom: decision buttons ──────────────────────────── */}
      <div
        className="ck-approval-actions"
        style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}
      >
        <Button variant="primary" size="sm" onClick={() => onRespond('once')}>
          允许一次
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onRespond('session')}>
          本次会话
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onRespond('always')}>
          总是允许
        </Button>
        <span style={{ flex: 1 }} />
        <Button variant="danger" size="sm" onClick={() => onRespond('deny')}>
          拒绝
        </Button>
      </div>
    </Card>
  );
}
