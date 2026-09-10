/**
 * 顶栏（阶段三产物）：状态点 / 标题 / 面板开关（Sessions/New/Review/Models/Settings）。
 */
import React from 'react';
import type { ConnectionStatus } from '../types.ts';

export interface TopBarProps {
  status: ConnectionStatus;
  model: string;
  sidecarInfo: string;
  activeSessionId: string;
  changesCount: number;
  onToggleSessions: () => void;
  onNewSession: () => void;
  onToggleReview: () => void;
  onToggleModels: () => void;
  onToggleSettings: () => void;
}

const STATUS_ICON: Record<ConnectionStatus, string> = {
  ready: '●',
  error: '✕',
  stopped: '○',
  starting: '◌',
};

export function TopBar(props: TopBarProps): JSX.Element {
  const {
    status, model, sidecarInfo, activeSessionId, changesCount,
    onToggleSessions, onNewSession, onToggleReview, onToggleModels, onToggleSettings,
  } = props;
  return (
    <header className="topbar">
      <span className={`dot status-${status}`} title={`sidecar: ${status}`}>
        {STATUS_ICON[status]}
      </span>
      <span className="topbar-title">DSH CursorKit</span>
      <div className="topbar-actions">
        <button className="tb-btn" onClick={onToggleSessions} title="会话列表 / 新建">
          {activeSessionId ? activeSessionId.slice(0, 8) : '会话'}
        </button>
        <button className="tb-btn" onClick={onNewSession} title="新建会话（Composer 新任务）">
          + 新建
        </button>
        <button className="tb-btn" onClick={onToggleReview} title="审查 agent 改动">
          {changesCount > 0 ? `改动 ${changesCount}` : '改动'}
        </button>
        <button className="tb-btn" onClick={onToggleModels} title="选择模型">
          {model.split('/').pop() || model}
        </button>
        <button className="tb-btn" onClick={onToggleSettings} title="设置">
          ⚙
        </button>
      </div>
      <span className="topbar-sidecar">{sidecarInfo}</span>
    </header>
  );
}
