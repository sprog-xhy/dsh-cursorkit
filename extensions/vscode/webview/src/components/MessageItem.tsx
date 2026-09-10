/**
 * 消息项（阶段三产物）：
 * - user：右对齐低饱和卡片
 * - assistant：左对齐无气泡正文（markdown 渲染）
 * - tool：ToolCallCard 行内卡片
 * - system：居中弱化
 */
import React from 'react';
import type { ChatItem } from '../types.ts';
import { renderMd } from '../markdown.ts';
import { ThinkingBlock } from './ThinkingBlock.tsx';
import { ToolCallCard } from './ToolCallCard.tsx';

export function MessageItem({ item }: { item: ChatItem }): JSX.Element {
  if (item.role === 'tool') {
    return (
      <div className="msg msg-tool">
        <ToolCallCard name={item.text} status={item.status} output={item.toolName} />
      </div>
    );
  }
  if (item.role === 'assistant') {
    return (
      <div className="msg msg-assistant">
        <div className="msg-text" dangerouslySetInnerHTML={{ __html: renderMd(item.text) }} />
      </div>
    );
  }
  if (item.role === 'system') {
    // thinking 前缀 → ThinkingBlock；其余居中弱化
    if (item.text.startsWith('🤔') || item.text.startsWith('思考')) {
      const body = item.text.replace(/^🤔\s*/, '').replace(/^思考:\s*/, '');
      return (
        <div className="msg msg-system">
          <ThinkingBlock text={body} />
        </div>
      );
    }
    return (
      <div className="msg msg-system">
        <span className={`msg-system-text ${item.text.includes('已停止') ? 'stopped' : ''}`}>{item.text}</span>
      </div>
    );
  }
  // user
  return (
    <div className="msg msg-user">
      <div className="msg-user-bubble">{item.text}</div>
    </div>
  );
}
