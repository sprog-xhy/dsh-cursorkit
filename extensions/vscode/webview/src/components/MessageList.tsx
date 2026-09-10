/**
 * 消息流。
 *
 * 修复：流式输出时不自动滚动（原先 effect 只依赖 items.length，而增量文本不改变长度）。
 * 优化：向上滚动时显示"回到最新"按钮；超过 DOM 上限时提示省略条数；流式"生成中"占位。
 */
import React, { useEffect, useRef, useState } from 'react';
import type { ChatItem } from '../types.ts';
import { MessageItem } from './MessageItem.tsx';

export const MAX_DOM_ITEMS = 500;

export interface MessageListProps {
  items: ChatItem[];
  busy: boolean;
}

export function MessageList({ items, busy }: MessageListProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // 依赖 items 引用（每次增量都是新数组）→ 流式文本增长也会跟随滚动
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickToBottom) {
      el.scrollTop = el.scrollHeight;
    }
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

  return (
    <div className="messages-wrap">
      <div className="messages" ref={listRef} onScroll={onScroll}>
        {items.length === 0 && (
          <div className="empty">
            <div className="empty-title">DSH CursorKit</div>
            <div className="empty-sub">以 dsh 为内核的 AI 编程助手 · 输入问题或选中代码按 Ctrl+K</div>
          </div>
        )}
        {skipped > 0 && <div className="msgs-skipped">已省略较早的 {skipped} 条消息</div>}
        {tail.map((it) => (
          <MessageItem key={it.id} item={it} />
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
            <path d="M6 2v8M3 7l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
