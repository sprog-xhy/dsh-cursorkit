/**
 * 通用抽屉面板容器。
 * 清理：移除原先未生效的 mounted 状态与 ref（CSS 已由 .panel 动画承担）。
 */
import React from 'react';

export interface PanelProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 空态文案（无子项时显示）。 */
  emptyText?: string;
  /** 头部右侧附加动作。 */
  extra?: React.ReactNode;
}

export function Panel({ title, onClose, children, emptyText, extra }: PanelProps): JSX.Element {
  const hasContent = React.Children.count(children) > 0;
  return (
    <section className="panel" aria-label={title}>
      <div className="panel-header">
        <span className="panel-title">{title}</span>
        {extra}
        <button className="panel-close" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="panel-body">
        {hasContent ? children : <div className="panel-empty">{emptyText ?? '暂无内容'}</div>}
      </div>
    </section>
  );
}
