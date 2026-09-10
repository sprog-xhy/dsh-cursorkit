/**
 * 内联改动卡片（Cursor 风格）：
 * agent 写了文件 → 聊天流里直接出现「✏️ 文件 +N -M [diff] [还原]」，
 * 不必再去审查面板找。接受 = 保留（文件已在磁盘），还原 = git 还原。
 */
import React from 'react';

export interface ChangeCardProps {
  path: string;
  additions: number;
  deletions: number;
  status?: string;
  onDiff: () => void;
  onRevert: () => void;
  onOpen: () => void;
}

function statusLabel(status?: string): string {
  if (status === 'added' || status === 'created') return '新增';
  if (status === 'deleted') return '删除';
  return '修改';
}

export function ChangeCard(props: ChangeCardProps): JSX.Element {
  const { path, additions, deletions, status, onDiff, onRevert, onOpen } = props;
  const hasStats = additions > 0 || deletions > 0;
  const file = path.split('/').pop() ?? path;
  return (
    <div className="change-card">
      <span className="change-icon" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
          <path d="M8.5 1.5l2 2L4 10H2V8l6.5-6.5z" />
        </svg>
      </span>
      <span className="change-chip">{statusLabel(status)}</span>
      <button className="change-path" title={path} onClick={onOpen}>
        {file}
      </button>
      {hasStats && (
        <span className="change-stats">
          {additions > 0 && <span className="stat-add">+{additions}</span>}
          {deletions > 0 && <span className="stat-del">-{deletions}</span>}
        </span>
      )}
      <span className="change-actions">
        <button className="panel-btn" onClick={onDiff} title="与 git HEAD 对比">
          查看差异
        </button>
        <button className="panel-btn danger" onClick={onRevert} title="还原这个文件">
          撤销
        </button>
      </span>
    </div>
  );
}
