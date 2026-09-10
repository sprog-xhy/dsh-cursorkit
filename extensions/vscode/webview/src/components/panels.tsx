/**
 * 五个面板组件（阶段三产物）：Sessions / Models / Review / Checkpoints / Settings。
 * 全部基于统一 Panel 容器；保持消息协议零改动。
 */
import React from 'react';
import type { CheckpointInfo, ModelInfo, ReviewChange, SessionInfo, SettingsData } from '../types.ts';
import { Panel } from './Panel.tsx';

export interface SessionsPanelProps {
  sessions: SessionInfo[];
  activeSessionId: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

export function SessionsPanel(props: SessionsPanelProps): JSX.Element {
  const { sessions, activeSessionId, onSwitch, onNew, onClose } = props;
  return (
    <Panel title="会话" onClose={onClose} emptyText="暂无会话" extra={<button className="panel-btn" onClick={onNew}>+ 新建</button>}>
      {sessions.map((s) => (
        <div key={s.id} className={`panel-row ${s.id === activeSessionId ? 'active' : ''}`} onClick={() => onSwitch(s.id)}>
          <span className="panel-row-main">{s.id.slice(0, 12)}</span>
          <span className="panel-row-sub">{s.workspace.split('/').pop()}</span>
          {s.id === activeSessionId && <span className="panel-row-dot" />}
        </div>
      ))}
    </Panel>
  );
}

export interface ModelsPanelProps {
  models: ModelInfo[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function ModelsPanel(props: ModelsPanelProps): JSX.Element {
  const { models, onSelect, onClose } = props;
  return (
    <Panel title="模型" onClose={onClose} emptyText="无可用模型（检查 settings.yaml）">
      {models.map((m) => (
        <div key={m.id} className="panel-row" onClick={() => onSelect(m.id)}>
          <span className="panel-row-main">{m.id}</span>
          <span className="panel-row-sub">{m.provider}</span>
        </div>
      ))}
    </Panel>
  );
}

export interface ReviewPanelProps {
  changes: ReviewChange[];
  onDiff: (path: string) => void;
  onReject: (path: string) => void;
  onClose: () => void;
}

export function ReviewPanel(props: ReviewPanelProps): JSX.Element {
  const { changes, onDiff, onReject, onClose } = props;
  return (
    <Panel title="Agent 改动" onClose={onClose} emptyText="暂无改动">
      {changes.map((c) => (
        <div key={c.path} className="panel-row">
          <span className="panel-row-main" title={c.path}>{c.path}</span>
          <span className="panel-row-stat">
            <span className="stat-add">+{c.additions}</span>
            <span className="stat-del">-{c.deletions}</span>
          </span>
          <span className="panel-row-actions">
            <button className="panel-btn" onClick={() => onDiff(c.path)}>diff</button>
            <button className="panel-btn danger" onClick={() => onReject(c.path)}>还原</button>
          </span>
        </div>
      ))}
    </Panel>
  );
}

export interface CheckpointsPanelProps {
  checkpoints: CheckpointInfo[];
  onRollback: (id: string) => void;
  onClose: () => void;
}

export function CheckpointsPanel(props: CheckpointsPanelProps): JSX.Element {
  const { checkpoints, onRollback, onClose } = props;
  return (
    <Panel title="Checkpoint 时间线" onClose={onClose} emptyText="暂无 checkpoint（agent 改动后自动创建）">
      {[...checkpoints].reverse().map((cp) => (
        <div key={cp.id} className="panel-row">
          <span className="panel-row-main">
            {new Date(cp.createdAt).toLocaleTimeString()} · {cp.summary.slice(0, 40)}
          </span>
          <span className="panel-row-sub">{cp.commit ? cp.commit.slice(0, 7) : ''}</span>
          <span className="panel-row-actions">
            <button className="panel-btn danger" onClick={() => onRollback(cp.id)}>回滚</button>
          </span>
        </div>
      ))}
    </Panel>
  );
}

export interface SettingsPanelProps {
  data: SettingsData;
  onToggleTab: () => void;
  onClose: () => void;
}

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const { data, onToggleTab, onClose } = props;
  const { rules, config } = data;
  return (
    <Panel title="设置" onClose={onClose}>
      <div className="settings-group">
        <div className="settings-row">
          <span>Tab 补全</span>
          <button className="panel-btn" onClick={onToggleTab}>
            {config.tabEnabled ? '开' : '关'}
          </button>
        </div>
        <div className="settings-row">
          <span>权限模式</span>
          <span className="panel-row-sub">{config.permissionMode}</span>
        </div>
      </div>
      <div className="settings-group">
        <div className="settings-group-title">Rules</div>
        {rules.project.length === 0 && !rules.global && (
          <div className="panel-empty">无 Rules（项目 .cursorrules 或 ~/.cursorrules）</div>
        )}
        {rules.project.map((r, i) => (
          <div key={i} className="settings-row">
            <span className="panel-row-main">{r.split('\n')[0].replace('## ', '')}</span>
          </div>
        ))}
        {rules.global && (
          <div className="settings-row">
            <span className="panel-row-main">~/.cursorrules（全局）</span>
          </div>
        )}
      </div>
    </Panel>
  );
}
