/**
 * 顶栏：状态点 / 标题 / 面板开关（Sessions / New / Review / Models / Checkpoints / Settings）。
 * 优化：当前打开的面板高亮；连接状态带文字提示；有改动时改动按钮计数高亮。
 */
import React from 'react';
import type { ConnectionStatus } from '../types.ts';

export interface TopBarProps {
  status: ConnectionStatus;
  model: string;
  sidecarInfo: string;
  activeSessionId: string;
  changesCount: number;
  activePanel: string | null;
  onToggleSessions: () => void;
  onNewSession: () => void;
  onToggleReview: () => void;
  onToggleModels: () => void;
  onToggleSettings: () => void;
  onToggleCheckpoints: () => void;
}

const STATUS_META: Record<ConnectionStatus, { icon: string; label: string }> = {
  ready: { icon: '●', label: '已连接' },
  starting: { icon: '◌', label: '启动中' },
  error: { icon: '✕', label: '连接错误' },
  stopped: { icon: '○', label: '已停止' },
};

export function TopBar(props: TopBarProps): JSX.Element {
  const {
    status, model, sidecarInfo, activeSessionId, changesCount, activePanel,
    onToggleSessions, onNewSession, onToggleReview, onToggleModels, onToggleSettings, onToggleCheckpoints,
  } = props;
  const meta = STATUS_META[status];
  const cls = (kind: string): string => `tb-btn ${activePanel === kind ? 'active' : ''}`;

  return (
    <header className="topbar">
      <span className={`dot status-${status}`} data-dsh="status" title={`sidecar: ${meta.label} ${sidecarInfo}`}>
        {meta.icon}
      </span>
      <span className="topbar-title" title={sidecarInfo || meta.label}>
        DSH CursorKit
      </span>
      <div className="topbar-actions">
        <button className={cls('sessions')} data-dsh="session" onClick={onToggleSessions} title="会话列表 / 新建">
          {activeSessionId ? activeSessionId.slice(0, 8) : '会话'}
        </button>
        <button className="tb-btn" onClick={onNewSession} title="新建会话（Composer 新任务）">
          ＋
        </button>
        <button
          className={`${cls('review')} ${changesCount > 0 ? 'accent' : ''}`}
          onClick={onToggleReview}
          title="审查 agent 改动"
        >
          改动{changesCount > 0 ? ` ${changesCount}` : ''}
        </button>
        <button className={cls('checkpoints')} onClick={onToggleCheckpoints} title="Checkpoint 时间线（回滚）">
          时间线
        </button>
        <button className={cls('models')} data-dsh="model" onClick={onToggleModels} title="选择模型">
          {model}
        </button>
        <button className={cls('settings')} onClick={onToggleSettings} title="设置">
          ⚙
        </button>
      </div>
      <span className="topbar-sidecar" title={sidecarInfo}>
        {sidecarInfo}
      </span>
    </header>
  );
}
