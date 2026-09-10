/**
 * Composer（阶段三产物）：输入框 + Ask/Edit/Agent 模式条 + 发送/停止。
 * 聚焦描边 8px 圆角；模式切换高亮；发送按钮品牌色。
 */
import React, { useRef } from 'react';
import type { ChatMode } from '../types.ts';

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;
}

const MODES: { key: ChatMode; label: string; hint: string }[] = [
  { key: 'ask', label: 'Ask', hint: '只问答，不修改文件' },
  { key: 'edit', label: 'Edit', hint: '聚焦修改指定内容' },
  { key: 'agent', label: 'Agent', hint: '多文件自动执行' },
];

export function Composer(props: ComposerProps): JSX.Element {
  const { value, onChange, onSend, onStop, busy, mode, onModeChange } = props;
  const taRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={taRef}
          value={value}
          placeholder="询问代码 / 让 agent 修改（Enter 发送，Shift+Enter 换行）"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <div className="composer-footer">
          <div className="mode-bar">
            {MODES.map((m) => (
              <button
                key={m.key}
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
              <button className="btn-stop" onClick={onStop} title="停止">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <rect x="1" y="1" width="8" height="8" rx="1.5" />
                </svg>
                停止
              </button>
            )}
            <button
              className="btn-send"
              onClick={onSend}
              disabled={!value.trim() || busy}
              title="发送 (Enter)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M12 2L6.5 7.5M12 2L8 12L6.5 7.5M12 2L2 6L6.5 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
