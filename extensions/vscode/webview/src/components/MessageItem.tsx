/**
 * 消息项：
 * - user：右对齐卡片
 * - assistant：左对齐正文（markdown），悬停可复制
 * - tool：工具卡片
 * - thinking：折叠折叠块
 * - system：左对齐弱化（错误红色 / 停止红色）
 */
import React, { useState } from 'react';
import type { ChatItem } from '../types.ts';
import { renderMd } from '../markdown.ts';
import { ThinkingBlock } from './ThinkingBlock.tsx';
import { ToolCallCard } from './ToolCallCard.tsx';

function timeOf(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function MessageItem({ item }: { item: ChatItem }): JSX.Element {
  const [copied, setCopied] = useState(false);

  if (item.role === 'tool') {
    return (
      <div className="msg msg-tool">
        <ToolCallCard name={item.text} status={item.status} output={item.output} />
      </div>
    );
  }

  if (item.role === 'thinking') {
    return (
      <div className="msg msg-system">
        <ThinkingBlock text={item.text} />
      </div>
    );
  }

  if (item.role === 'assistant') {
    const copy = (): void => {
      void navigator.clipboard?.writeText(item.text).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        },
        () => undefined,
      );
    };
    return (
      <div className="msg msg-assistant">
        <div className="msg-text" dangerouslySetInnerHTML={{ __html: renderMd(item.text) }} />
        <button className="msg-copy" onClick={copy} title="复制回复">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    );
  }

  if (item.role === 'system') {
    const cls =
      item.level === 'error' ? 'error' : item.level === 'stopped' ? 'stopped' : '';
    return (
      <div className="msg msg-system">
        <span className={`msg-system-text ${cls}`}>
          {timeOf(item.ts) && <span className="msg-time">{timeOf(item.ts)}</span>}
          {item.text}
        </span>
      </div>
    );
  }

  return (
    <div className="msg msg-user">
      <div className="msg-user-bubble">
        {item.text}
        {timeOf(item.ts) && <span className="msg-time">{timeOf(item.ts)}</span>}
      </div>
    </div>
  );
}
