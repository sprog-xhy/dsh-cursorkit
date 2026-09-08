import { useMemo, useState } from 'react';
import { colors, fonts, radii } from './lib/theme.ts';
import { formatRelativeTime } from './lib/format.ts';
import { Collapsible } from './primitives/Collapsible.tsx';
import { JsonTree } from './primitives/JsonTree.tsx';

export interface TrajectoryItem {
  id: string;
  source: string;
  title: string;
  payload?: unknown;
  ts: number;
}

export interface TrajectoryPanelProps {
  items: TrajectoryItem[];
  className?: string;
}

/**
 * Trajectory panel: items grouped by `source` (系统提示 / 思维链 / 工具 /
 * 子 agent / 上下文注入…). Each item is expandable to reveal its raw payload
 * as a JSON tree. Grouping order follows first appearance.
 */
export function TrajectoryPanel({ items, className }: TrajectoryPanelProps) {
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, TrajectoryItem[]>();
    for (const it of items) {
      if (!map.has(it.source)) {
        map.set(it.source, []);
        order.push(it.source);
      }
      map.get(it.source)?.push(it);
    }
    return order.map((source) => ({ source, items: map.get(source) ?? [] }));
  }, [items]);

  return (
    <div
      className={className ? `ck-trajectory ${className}` : 'ck-trajectory'}
      style={{ fontFamily: fonts.sans }}
    >
      {groups.length === 0 && (
        <div style={{ padding: 12, textAlign: 'center', color: colors.textMuted, fontSize: 12.5 }}>轨迹为空</div>
      )}
      {groups.map((group) => (
        <div key={group.source} style={{ marginBottom: 10 }}>
          <div
            className="ck-trajectory-group"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 2px 6px',
              fontSize: 11.5,
              fontWeight: 600,
              color: colors.textSecondary,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
            }}
          >
            <span>{group.source}</span>
            <span
              style={{
                backgroundColor: colors.graySoft,
                color: colors.textMuted,
                borderRadius: 999,
                padding: '0 7px',
                fontSize: 10.5,
                fontWeight: 500,
              }}
            >
              {group.items.length}
            </span>
          </div>
          <div
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: radii.md,
              overflow: 'hidden',
              backgroundColor: colors.surface,
            }}
          >
            {group.items.map((it, i) => (
              <ItemRow key={it.id} item={it} first={i === 0} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ItemRow({ item, first }: { item: TrajectoryItem; first: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="ck-trajectory-item"
      style={{
        borderTop: first ? undefined : `1px solid ${colors.border}`,
        padding: '6px 10px',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
      >
        <span
          style={{
            fontSize: 12.5,
            color: colors.text,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.title}
        </span>
        <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>
          {formatRelativeTime(item.ts)}
        </span>
        <span style={{ fontSize: 11, color: open ? colors.blue : colors.textMuted, width: 34, textAlign: 'right' }}>
          {open ? '收起' : '展开'}
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${colors.border}` }}>
          {item.payload === undefined ? (
            <div style={{ fontSize: 12, color: colors.textMuted }}>无附加数据</div>
          ) : (
            <JsonTree value={item.payload} maxDepth={1} />
          )}
        </div>
      )}
    </div>
  );
}
