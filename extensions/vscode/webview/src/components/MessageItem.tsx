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
import { ChangeCard } from './ChangeCard.tsx';

function timeOf(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export interface MessageItemProps {
  item: ChatItem;
  /** 改动卡片动作（可选：历史回放时不需要）。 */
  onDiff?: (path: string) => void;
  onRevert?: (path: string) => void;
  onOpen?: (path: string) => void;
}

export function MessageItem({ item, onDiff, onRevert, onOpen }: MessageItemProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  if (item.role === 'change') {
    return (
      <div className="msg msg-change">
        <ChangeCard
          path={item.path ?? item.text}
          additions={item.additions ?? 0}
          deletions={item.deletions ?? 0}
          status={item.status}
          onDiff={() => onDiff?.(item.path ?? item.text)}
          onRevert={() => onRevert?.(item.path ?? item.text)}
          onOpen={() => onOpen?.(item.path ?? item.text)}
        />
      </div>
    );
  }

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
