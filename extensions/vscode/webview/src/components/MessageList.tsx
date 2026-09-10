/**
 * 消息流（阶段三产物）。
 * D30 预留：DOM 上限 ~500 条——超过时只渲染尾部窗口（保持最新对话可见）。
 * 空态保留现有中文文案。
 */
import React, { useEffect, useRef, useState } from 'react';
import type { ChatItem } from '../types.ts';
import { MessageItem } from './MessageItem.tsx';

export const MAX_DOM_ITEMS = 500;

export function MessageList({ items }: { items: ChatItem[] }): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [items.length, autoScroll]);

  const onScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    // 用户上滚 → 暂停自动滚；滚到底 → 恢复
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(nearBottom);
  };

  // DOM 上限：只渲染尾部窗口（items.length - MAX 起）
  const tail = items.length > MAX_DOM_ITEMS ? items.slice(-MAX_DOM_ITEMS) : items;
  const skipped = items.length - tail.length;

  return (
    <div className="messages" ref={listRef} onScroll={onScroll}>
      {items.length === 0 && (
        <div className="empty">
          <div className="empty-title">DSH CursorKit</div>
          <div className="empty-sub">以 dsh 为内核的 AI 编程助手（Cursor 同款体验）</div>
        </div>
      )}
      {skipped > 0 && (
        <div className="msgs-skipped">已省略较早的 {skipped} 条消息</div>
      )}
      {tail.map((it) => (
        <MessageItem key={it.id} item={it} />
      ))}
    </div>
  );
}
