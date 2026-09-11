/**
 * 消息流。
 *
 * - 修复：流式输出时不自动滚动（原先 effect 只依赖 items.length）
 * - 修复：同一轮的文本与工具调用视觉割裂 → 按 `turn` 归组（协议 CkpTurnStep 透传）
 * - 优化：回到最新按钮、DOM 上限省略提示、生成中指示
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatItem } from '../types.ts';
import { MessageItem } from './MessageItem.tsx';

export const MAX_DOM_ITEMS = 500;

export interface MessageListProps {
  items: ChatItem[];
  busy: boolean;
  /** 改动卡片动作（review.diff / review.reject / review.open）。 */
  onDiff?: (path: string) => void;
  onRevert?: (path: string) => void;
  onOpen?: (path: string) => void;
  /** 保留（Keep）某个文件的改动。 */
  onKeep?: (path: string) => void;
  /** 消息级操作。 */
  onRetry?: (text: string) => void;
  onEdit?: (text: string) => void;
  /** checkpointId 映射：groupKey → checkpoint id（用于"回滚到此"）。 */
  checkpointByGroup?: Record<string, string>;
  onRestore?: (checkpointId: string) => void;
}

interface Group {
  key: string;
  turn?: number;
  items: ChatItem[];
}

/** 按 turn 归组（无 turn 的条目各成一组）。 */
export function groupByTurn(items: ChatItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && item.turn !== undefined && last.turn === item.turn) {
      last.items.push(item);
      continue;
    }
    groups.push({
      key: `${item.turn ?? 'x'}-${item.id}`,
      turn: item.turn,
      items: [item],
    });
  }
  return groups;
}

export function MessageList({
  items,
  busy,
  onDiff,
  onRevert,
  onOpen,
  onKeep,
  onRetry,
  onEdit,
  checkpointByGroup,
  onRestore,
}: MessageListProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // 依赖 items 引用（每次增量都是新数组）→ 流式文本增长也会跟随滚动
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickToBottom) el.scrollTop = el.scrollHeight;
  }, [items, stickToBottom]);

  const onScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    setStickToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const jumpToBottom = (): void => {
    const el = listRef.current;
    if (!el) return;
    setStickToBottom(true);
    el.scrollTop = el.scrollHeight;
  };

  const tail = items.length > MAX_DOM_ITEMS ? items.slice(-MAX_DOM_ITEMS) : items;
  const skipped = items.length - tail.length;
  const groups = useMemo(() => groupByTurn(tail), [tail]);

  return (
    <div className="messages-wrap">
      <div
        className="messages"
        ref={listRef}
        onScroll={onScroll}
        aria-live="polite"
        aria-relevant="additions text"
      >
        {items.length === 0 && (
          <div className="empty">
            <div className="empty-title">DSH CursorKit</div>
            <div className="empty-sub">
              以 dsh 为内核的 AI 编程助手 · 输入问题或选中代码按 Ctrl+K
            </div>
          </div>
        )}
        {skipped > 0 && <div className="msgs-skipped">已省略较早的 {skipped} 条消息</div>}
        {groups.map((g) => (
          <div className={`turn ${g.turn !== undefined ? 'turn-tagged' : ''}`} key={g.key}>
            {g.items.map((it, idx) => (
              <MessageItem
                key={it.id}
                item={it}
                onDiff={onDiff}
                onRevert={onRevert}
                onOpen={onOpen}
                onKeep={onKeep}
                onRetry={onRetry}
                onEdit={onEdit}
                onRestore={onRestore}
                checkpointId={
                  // 只在每组的最后一条助手消息上显示"回滚到此"，避免刷屏
                  it.role === 'assistant' && idx === g.items.length - 1
                    ? checkpointByGroup?.[g.key]
                    : undefined
                }
              />
            ))}
          </div>
        ))}
        {busy && (
          <div className="msg msg-assistant">
            <span className="typing" aria-label="生成中">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>
      {!stickToBottom && (
        <button className="jump-bottom" onClick={jumpToBottom} title="回到最新">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M6 2v8M3 7l3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
