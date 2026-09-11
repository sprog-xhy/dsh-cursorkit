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
  /** 保留（Keep）某个文件的改动。 */
  onKeep?: (path: string) => void;
  /** 重新生成这条回复（重发对应的用户消息）。 */
  onRetry?: (text: string) => void;
  /** 把这条用户消息载入输入框编辑后重发。 */
  onEdit?: (text: string) => void;
  /** 该轮对应的 checkpoint id（存在时显示"回滚到此"）。 */
  checkpointId?: string;
  onRestore?: (checkpointId: string) => void;
}

export function MessageItem({
  item,
  onDiff,
  onRevert,
  onOpen,
  onKeep,
  onRetry,
  onEdit,
  checkpointId,
  onRestore,
}: MessageItemProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copyText = (): void => {
    void navigator.clipboard?.writeText(item.text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => undefined,
    );
  };

  if (item.role === 'change') {
    return (
      <div className="msg msg-change">
        <ChangeCard
          path={item.path ?? item.text}
          additions={item.additions ?? 0}
          deletions={item.deletions ?? 0}
          status={item.status}
          changeState={item.changeState}
          onDiff={() => onDiff?.(item.path ?? item.text)}
          onRevert={() => onRevert?.(item.path ?? item.text)}
          onOpen={() => onOpen?.(item.path ?? item.text)}
          onKeep={() => onKeep?.(item.path ?? item.text)}
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
    return (
      <div className="msg msg-assistant">
        <div className="msg-text" dangerouslySetInnerHTML={{ __html: renderMd(item.text) }} />
        <div className="msg-actions">
          <button className="msg-copy" onClick={copyText} title="复制回复">
            {copied ? '已复制' : '复制'}
          </button>
          {item.retryText && onRetry && (
            <button className="msg-copy" onClick={() => onRetry(item.retryText ?? '')} title="重新生成">
              重新生成
            </button>
          )}
          {checkpointId && onRestore && (
            <button
              className="msg-copy"
              onClick={() => onRestore(checkpointId)}
              title="把工作区回滚到这条回复之后的状态（撤销其后的所有改动）"
            >
              回滚到此
            </button>
          )}
        </div>
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
      <div className="msg-actions user-actions">
        <button className="msg-copy" onClick={copyText} title="复制">
          {copied ? '已复制' : '复制'}
        </button>
        {onEdit && (
          <button className="msg-copy" onClick={() => onEdit(item.text)} title="载入输入框，编辑后重发">
            编辑重发
          </button>
        )}
      </div>
    </div>
  );
}
