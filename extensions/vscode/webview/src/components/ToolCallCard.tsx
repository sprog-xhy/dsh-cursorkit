/**
 * 工具调用卡片（阶段三产物）。
 * 图标 + 工具名 + 状态徽章（tl-* 时间线色）+ 可折叠输出。
 * 状态色：running=--ds-tl-run / done=--ds-tl-grep / failed=--ds-tl-fail。
 */
import React, { useState } from 'react';

export interface ToolCallCardProps {
  name: string;
  status?: string;
  output?: string;
}

/** 按工具名推断时间线色（grep/read/edit/run）。 */
function timelineColor(name: string, status?: string): string {
  if (status === 'failed') return 'var(--ds-tl-fail)';
  const n = name.toLowerCase();
  if (n.includes('grep') || n.includes('search') || n.includes('检索')) return 'var(--ds-tl-grep)';
  if (n.includes('read') || n.includes('cat') || n.includes('读')) return 'var(--ds-tl-read)';
  if (n.includes('edit') || n.includes('write') || n.includes('patch') || n.includes('写')) return 'var(--ds-tl-edit)';
  if (n.includes('bash') || n.includes('run') || n.includes('exec')) return 'var(--ds-tl-run)';
  return 'var(--ds-tl-thinking)';
}

/** 工具图标（内联 SVG，无网络资源）。 */
function toolIcon(name: string): JSX.Element {
  const n = name.toLowerCase();
  const common = { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none' as const, stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' as const };
  if (n.includes('bash') || n.includes('run') || n.includes('exec')) {
    return <svg {...common}><path d="M2 3h8M2 6h8M2 9h5" /></svg>;
  }
  if (n.includes('edit') || n.includes('write') || n.includes('patch')) {
    return <svg {...common}><path d="M8.5 1.5l2 2L4 10H2V8l6.5-6.5z" /></svg>;
  }
  if (n.includes('read') || n.includes('cat')) {
    return <svg {...common}><path d="M2 1h8v10H2zM4.5 4h3M4.5 6h3" /></svg>;
  }
  if (n.includes('grep') || n.includes('search')) {
    return <svg {...common}><circle cx="5" cy="5" r="3" /><path d="M7.5 7.5L10 10" /></svg>;
  }
  return <svg {...common}><path d="M2 6h8M6 2v8" /></svg>;
}

export function ToolCallCard({ name, status, output }: ToolCallCardProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const color = timelineColor(name, status);
  const running = status === 'running' || !status;
  return (
    <div className="tool-card">
      <button className="tool-card-head" onClick={() => setOpen((v) => !v)}>
        <span className="tool-icon" style={{ color }}>
          {toolIcon(name)}
        </span>
        <span className="tool-name">{name}</span>
        <span className={`tool-status ${running ? 'running' : ''}`} style={{ color: running ? 'var(--ds-tl-run)' : color }}>
          {running ? '运行中' : status === 'failed' ? '失败' : '完成'}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`tool-chev ${open ? 'rot' : ''}`}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && output && (
        <div className="tool-card-output">
          <pre>{output}</pre>
        </div>
      )}
    </div>
  );
}
