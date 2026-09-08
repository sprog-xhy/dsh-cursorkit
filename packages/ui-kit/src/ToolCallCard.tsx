import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ToolCall } from '@dsh-cursorkit/protocol';
import { colors, fonts, radii } from './lib/theme.ts';
import { formatDurationMs } from './lib/format.ts';
import { BanIcon, CheckCircleIcon, ClockIcon, XCircleIcon } from './lib/icons.tsx';
import { Badge } from './primitives/Badge.tsx';
import type { BadgeTone } from './primitives/Badge.tsx';
import { Collapsible } from './primitives/Collapsible.tsx';
import { JsonTree } from './primitives/JsonTree.tsx';
import { Spinner } from './primitives/Spinner.tsx';

export interface ToolCallCardProps {
  call: ToolCall;
  className?: string;
}

const statusMeta: Record<
  ToolCall['status'],
  { label: string; tone: BadgeTone; iconColor: string; headerColor: string }
> = {
  pending: { label: '等待中', tone: 'neutral', iconColor: colors.textMuted, headerColor: colors.textSecondary },
  running: { label: '执行中', tone: 'blue', iconColor: colors.blue, headerColor: colors.blue },
  success: { label: '成功', tone: 'success', iconColor: colors.green, headerColor: colors.greenDark },
  error: { label: '失败', tone: 'error', iconColor: colors.red, headerColor: colors.redDark },
  denied: { label: '已拒绝', tone: 'neutral', iconColor: colors.textMuted, headerColor: colors.textSecondary },
};

function statusIcon(status: ToolCall['status'], color: string): ReactNode {
  switch (status) {
    case 'pending':
      return <ClockIcon size={15} color={color} />;
    case 'running':
      return <Spinner size={13} color={color} strokeWidth={2} />;
    case 'success':
      return <CheckCircleIcon size={15} color={color} />;
    case 'error':
      return <XCircleIcon size={15} color={color} />;
    case 'denied':
      return <BanIcon size={15} color={color} />;
  }
}

const MAX_OUTPUT_LINES = 20;

/**
 * Tool-call card — the core of the tool experience.
 *
 * Header: status icon + mono tool name + status badge + duration.
 * Body: collapsible args (JSON tree) and collapsible output (mono, capped at
 * 20 lines with an "展开全部" toggle); errors render in red.
 */
export function ToolCallCard({ call, className }: ToolCallCardProps) {
  const meta = statusMeta[call.status];
  const [outputExpanded, setOutputExpanded] = useState(false);

  const outputLines = call.output ? call.output.split('\n') : [];
  const truncated = outputLines.length > MAX_OUTPUT_LINES;
  const visibleLines = truncated && !outputExpanded ? outputLines.slice(0, MAX_OUTPUT_LINES) : outputLines;

  const hasArgs = call.args !== undefined && call.args !== null;
  const duration = formatDurationMs(call.durationMs);
  const nonZeroExit = call.exitCode !== undefined && call.exitCode !== 0;

  return (
    <div
      className={className ? `ck-toolcall ${className}` : 'ck-toolcall'}
      style={{
        backgroundColor: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        marginBottom: 8,
        overflow: 'hidden',
        fontFamily: fonts.sans,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div
        className="ck-toolcall-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          borderBottom: `1px solid ${colors.border}`,
          backgroundColor: '#fafaf9',
        }}
      >
        {statusIcon(call.status, meta.iconColor)}
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: 12.5,
            fontWeight: 600,
            color: meta.headerColor,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {call.name}
        </span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {duration && (
          <span className="ck-toolcall-duration" style={{ marginLeft: 'auto', fontSize: 11, color: colors.textMuted }}>
            {duration}
          </span>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="ck-toolcall-body" style={{ padding: '4px 10px 8px' }}>
        {hasArgs && (
          <Collapsible
            className="ck-toolcall-args"
            title="参数"
            compact
            right={<span style={{ color: colors.textMuted, fontSize: 11 }}>{argsSummary(call.args)}</span>}
          >
            <JsonTree value={call.args} maxDepth={2} />
          </Collapsible>
        )}

        {call.output !== undefined && call.output !== '' && (
          <Collapsible
            className="ck-toolcall-output"
            title="输出"
            compact
            defaultOpen={call.status === 'error'}
            right={
              truncated ? (
                <span style={{ color: colors.textMuted, fontSize: 11 }}>
                  {outputLines.length} 行
                </span>
              ) : undefined
            }
          >
            <pre
              style={{
                margin: 0,
                padding: '6px 8px',
                backgroundColor: '#0b1220',
                color: '#d6deeb',
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.55,
                fontFamily: fonts.mono,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 260,
                overflowY: 'auto',
              }}
            >
              {visibleLines.join('\n')}
              {truncated && !outputExpanded ? '\n…' : ''}
            </pre>
            {truncated && (
              <button
                type="button"
                onClick={() => setOutputExpanded((e) => !e)}
                style={{
                  marginTop: 4,
                  border: 'none',
                  background: 'none',
                  color: colors.blue,
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                  fontFamily: fonts.sans,
                }}
              >
                {outputExpanded ? '收起' : '展开全部'}
              </button>
            )}
          </Collapsible>
        )}

        {nonZeroExit && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11.5,
              color: colors.amberDark,
              backgroundColor: colors.amberSoft,
              border: `1px solid ${colors.amberBorder}`,
              borderRadius: 6,
              padding: '4px 8px',
            }}
          >
            退出码 {call.exitCode}
          </div>
        )}

        {call.error && (
          <div
            className="ck-toolcall-error"
            style={{
              marginTop: 4,
              fontSize: 12.5,
              color: colors.redDark,
              backgroundColor: colors.redSoft,
              border: `1px solid ${colors.redBorder}`,
              borderRadius: 6,
              padding: '6px 8px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: fonts.mono,
            }}
          >
            {call.error}
          </div>
        )}
      </div>
    </div>
  );
}

function argsSummary(args: unknown): string {
  if (args === null || typeof args !== 'object') return typeof args === 'string' ? '字符串' : typeof args;
  const n = Array.isArray(args) ? args.length : Object.keys(args as Record<string, unknown>).length;
  return Array.isArray(args) ? `${n} 项` : `${n} 个键`;
}
