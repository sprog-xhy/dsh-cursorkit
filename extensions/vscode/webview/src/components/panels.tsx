/**
 * 五个面板组件：Sessions / Models / Review / Checkpoints / Settings。
 * 优化：
 * - Models 标记当前模型；Sessions 显示活跃项与工作区
 * - Review 增加"打开文件"动作、状态 chip、diff 统计双色
 * - Settings 支持加载中态（原先数据未到就完全不渲染）
 */
import React from 'react';
import type { CheckpointInfo, ModelInfo, ReviewChange, SessionInfo, SettingsData } from '../types.ts';
import { fullModelName } from '../types.ts';
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
    <Panel
      title={`会话${sessions.length ? ` · ${sessions.length}` : ''}`}
      onClose={onClose}
      emptyText="暂无会话（点“＋”新建）"
      extra={
        <button className="panel-btn" onClick={onNew}>
          ＋ 新建
        </button>
      }
    >
      {sessions.map((s) => {
        const active = s.id === activeSessionId;
        return (
          <div
            key={s.id}
            className={`panel-row ${active ? 'active' : ''}`}
            onClick={() => onSwitch(s.id)}
            title={s.workspace}
          >
            <span className={`panel-dot ${active ? 'on' : ''}`} />
            <span className="panel-row-main" title={s.id}>
              {s.summary?.trim() || s.id.slice(0, 14)}
            </span>
            <span className="panel-row-sub">{s.workspace.split('/').pop()}</span>
            {relTime(s.createdAt) && <span className="panel-row-mono">{relTime(s.createdAt)}</span>}
          </div>
        );
      })}
    </Panel>
  );
}

export interface ModelsPanelProps {
  models: ModelInfo[];
  current: string;
  onSelect: (m: ModelInfo) => void;
  onClose: () => void;
}

export function ModelsPanel(props: ModelsPanelProps): JSX.Element {
  const { models, current, onSelect, onClose } = props;
  return (
    <Panel title="模型" onClose={onClose} emptyText="无可用模型（检查 settings.yaml）">
      {models.map((m) => {
        const full = fullModelName(m);
        const active = full === current;
        return (
          <div
            key={full}
            className={`panel-row ${active ? 'active' : ''}`}
            onClick={() => onSelect(m)}
            title={full}
          >
            <span className={`panel-dot ${active ? 'on' : ''}`} />
            <span className="panel-row-main">{m.id}</span>
            <span className="panel-row-sub">{m.provider}</span>
          </div>
        );
      })}
    </Panel>
  );
}

export interface ReviewPanelProps {
  changes: ReviewChange[];
  onDiff: (path: string) => void;
  onReject: (path: string) => void;
  onOpen: (path: string) => void;
  onClose: () => void;
}

export function ReviewPanel(props: ReviewPanelProps): JSX.Element {
  const { changes, onDiff, onReject, onOpen, onClose } = props;
  return (
    <Panel
      title={`agent 改动${changes.length ? ` · ${changes.length}` : ''}`}
      onClose={onClose}
      emptyText="暂无改动（agent 写文件后会出现在这里）"
    >
      {changes.map((c) => (
        <div key={c.path} className="panel-row" title={c.path}>
          <span className="panel-chip">{statusLabel(c.status)}</span>
          <span className="panel-row-main" onClick={() => onOpen(c.path)}>
            {c.path}
          </span>
          {/* 行数为 best-effort 估算（host 从工具输出推断），未知时显示 — 而不是误导性的 -0 */}
          {c.additions > 0 || c.deletions > 0 ? (
            <span className="panel-row-stat" title="改动行数（估算，以 diff 为准）">
              {c.additions > 0 && <span className="stat-add">+{c.additions}</span>}
              {c.deletions > 0 && <span className="stat-del">-{c.deletions}</span>}
            </span>
          ) : (
            <span className="panel-row-sub" title="改动行数未知，请用 diff 查看">—</span>
          )}
          <span className="panel-row-actions">
            <button className="panel-btn" onClick={() => onDiff(c.path)} title="与 git HEAD 对比">
              diff
            </button>
            <button className="panel-btn danger" onClick={() => onReject(c.path)} title="还原该文件">
              还原
            </button>
          </span>
        </div>
      ))}
    </Panel>
  );
}

/** 相对时间（新建会话的面板更易读）。 */
function relTime(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function statusLabel(status: string): string {
  if (status === 'added' || status === 'created') return '新增';
  if (status === 'deleted') return '删除';
  return '修改';
}

export interface CheckpointsPanelProps {
  checkpoints: CheckpointInfo[];
  onRollback: (id: string) => void;
  onClose: () => void;
}

export function CheckpointsPanel(props: CheckpointsPanelProps): JSX.Element {
  const { checkpoints, onRollback, onClose } = props;
  return (
    <Panel
      title={`Checkpoint 时间线${checkpoints.length ? ` · ${checkpoints.length}` : ''}`}
      onClose={onClose}
      emptyText="暂无 checkpoint（agent 改动后自动创建）"
    >
      {[...checkpoints].reverse().map((cp) => (
        <div key={cp.id} className="panel-row" title={cp.summary}>
          <span className="panel-row-mono">{new Date(cp.createdAt).toLocaleTimeString()}</span>
          <span className="panel-row-main">{cp.summary.slice(0, 48)}</span>
          {cp.commit && <span className="panel-row-sub">{cp.commit.slice(0, 7)}</span>}
          <span className="panel-row-actions">
            <button className="panel-btn danger" onClick={() => onRollback(cp.id)}>
              回滚
            </button>
          </span>
        </div>
      ))}
    </Panel>
  );
}

export interface SettingsPanelProps {
  data: SettingsData | null;
  onToggleTab: () => void;
  onClose: () => void;
}

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const { data, onToggleTab, onClose } = props;
  if (!data) {
    return (
      <Panel title="设置" onClose={onClose}>
        <div className="panel-empty">读取设置中…</div>
      </Panel>
    );
  }
  const { rules, config } = data;
  return (
    <Panel title="设置" onClose={onClose}>
      <div className="settings-group">
        <div className="settings-group-title">功能</div>
        <div className="settings-row">
          <span>Tab 补全</span>
          <button className="panel-btn" onClick={onToggleTab}>
            {config.tabEnabled ? '已开启' : '已关闭'}
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
          <div className="panel-empty">无 Rules（.cursorrules / .cursor/rules/*.mdc / ~/.cursorrules）</div>
        )}
        {rules.project.map((r) => (
          <div key={r.name} className="settings-row">
            <span className="panel-row-main">{r.name}</span>
            {r.globs && <span className="panel-row-sub">{r.globs.join(' ')}</span>}
          </div>
        ))}
        {rules.global && (
          <div className="settings-row">
            <span className="panel-row-main">~/.cursorrules</span>
            <span className="panel-row-sub">全局</span>
          </div>
        )}
      </div>
    </Panel>
  );
}
