/**
 * Composer：输入框 + Ask/Edit/Agent 模式条 + 发送/停止。
 * 优化：未就绪时禁用并提示；Ctrl/Cmd+Enter 也可发送；模式带快捷键提示；高度自适应。
 */
import React, { useEffect } from 'react';
import type { ChatMode } from '../types.ts';

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;
  ready: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

const MODES: { key: ChatMode; label: string; hint: string }[] = [
  { key: 'ask', label: 'Ask', hint: 'Ask：只问答，不修改文件' },
  { key: 'edit', label: 'Edit', hint: 'Edit：聚焦修改指定内容' },
  { key: 'agent', label: 'Agent', hint: 'Agent：多文件自动执行（含计划）' },
];

export function Composer(props: ComposerProps): JSX.Element {
  const { value, onChange, onSend, onStop, busy, mode, onModeChange, ready, textareaRef } = props;

  // 输入框高度自适应（最多 ~10 行）
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, textareaRef]);

  const disabled = !ready;
  return (
    <div className="composer">
      <div className={`composer-box ${disabled ? 'disabled' : ''}`}>
        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          placeholder={
            disabled ? '正在连接 dsh sidecar…' : '询问代码 / 让 agent 修改（Enter 发送，Shift+Enter 换行）'
          }
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!busy) onSend();
            }
          }}
          rows={1}
        />
        <div className="composer-footer">
          <div className="mode-bar" role="tablist" aria-label="对话模式">
            {MODES.map((m) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={mode === m.key}
                className={`mode-btn ${mode === m.key ? 'active' : ''}`}
                onClick={() => onModeChange(m.key)}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="composer-actions">
            {busy && (
              <button className="btn-stop" onClick={onStop} title="停止生成 (Esc 面板关闭)">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <rect x="1" y="1" width="8" height="8" rx="1.5" />
                </svg>
                停止
              </button>
            )}
            <button
              className="btn-send"
              onClick={onSend}
              disabled={!value.trim() || busy || disabled}
              title="发送 (Enter)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M12 2L6.5 7.5M12 2L8 12L6.5 7.5M12 2L2 6L6.5 7.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
