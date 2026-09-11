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
  /** 处理状态：pending=待审查（显示 Keep/Undo）；accepted/reverted=已处理。 */
  changeState?: 'pending' | 'accepted' | 'reverted';
  onDiff: () => void;
  onRevert: () => void;
  onOpen: () => void;
  /** 保留（Keep）：接受改动，仅移出待审查列表。 */
  onKeep?: () => void;
}

function statusLabel(status?: string): string {
  if (status === 'added' || status === 'created') return '新增';
  if (status === 'deleted') return '删除';
  return '修改';
}

export function ChangeCard(props: ChangeCardProps): JSX.Element {
  const { path, additions, deletions, status, changeState, onDiff, onRevert, onOpen, onKeep } = props;
  const settled = changeState === 'accepted' || changeState === 'reverted';
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
        {settled ? (
          <span className={`change-settled ${changeState}`}>
            {changeState === 'accepted' ? '已保留' : '已撤销'}
          </span>
        ) : (
          <>
            <button className="panel-btn primary" onClick={onKeep} title="保留这次改动（Keep）">
              保留
            </button>
            <button className="panel-btn danger" onClick={onRevert} title="还原这个文件（Undo）">
              撤销
            </button>
          </>
        )}
        <button className="panel-btn" onClick={onDiff} title="与 git HEAD 对比">
          差异
        </button>
      </span>
    </div>
  );
}
