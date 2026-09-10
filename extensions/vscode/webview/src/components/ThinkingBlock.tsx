/**
 * Thinking 折叠块（阶段三产物）。
 * 用 --ds-tl-thinking 桃色点缀；点击展开/收起；Cursor 质感。
 */
import React, { useState } from 'react';

export function ThinkingBlock({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking-block">
      <button className="thinking-toggle" onClick={() => setOpen((v) => !v)}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={open ? 'rot' : ''}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="thinking-label">思考</span>
        <span className="thinking-dots">
          {open ? '' : '· · ·'}
        </span>
      </button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}
