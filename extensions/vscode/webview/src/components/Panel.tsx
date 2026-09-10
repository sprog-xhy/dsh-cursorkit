/**
 * 通用抽屉面板容器（阶段三产物，替换旧 .review-panel 复制品）。
 * 统一：标题栏 + 内容区 + 开合动效（≤200ms，Cursor 质感）。
 */
import React, { useEffect, useRef, useState } from 'react';

export interface PanelProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 面板空态文案（children 为空时显示）。 */
  emptyText?: string;
  /** 面板头部右侧附加（如刷新按钮）。 */
  extra?: React.ReactNode;
}

export function Panel({ title, onClose, children, emptyText, extra }: PanelProps): JSX.Element {
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 进入动效：下一帧加 open 类
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const hasContent = React.Children.count(children) > 0;

  return (
    <div className={`panel ${mounted ? 'panel-open' : ''}`} ref={ref} role="region" aria-label={title}>
      <div className="panel-header">
        <span className="panel-title">{title}</span>
        {extra}
        <button className="panel-close" onClick={onClose} title="关闭" aria-label="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="panel-body">
        {hasContent ? children : <div className="panel-empty">{emptyText ?? '暂无内容'}</div>}
      </div>
    </div>
  );
}
