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
  /** 连接状态，用于给出更准确的未就绪提示。 */
  status: 'starting' | 'ready' | 'error' | 'stopped';
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  /** @ 提及文件：搜索回调（输入 @ 后触发）。 */
  onSearchFiles?: (query: string) => void;
  /** @ 提及：候选文件。 */
  fileResults?: string[];
  /** 排队中的消息条数（生成中仍可输入并排队）。 */
  queued?: number;
}

const MODES: { key: ChatMode; label: string; hint: string }[] = [
  { key: 'ask', label: 'Ask', hint: 'Ask：只问答，不修改文件' },
  { key: 'edit', label: 'Edit', hint: 'Edit：聚焦修改指定内容' },
  { key: 'agent', label: 'Agent', hint: 'Agent：多文件自动执行（含计划）' },
];

/** 按模式给出占位提示。 */
const PLACEHOLDER: Record<ChatMode, string> = {
  ask: '问一个问题（Enter 发送，Shift+Enter 换行）',
  edit: '描述要如何修改选中代码（Enter 发送）',
  agent: '描述任务，可跨多个文件（Enter 发送）',
};

function placeholderFor(ready: boolean, status: ComposerProps['status'], mode: ChatMode): string {
  if (ready) return PLACEHOLDER[mode];
  if (status === 'error') return 'sidecar 连接失败（查看输出面板：DSH CursorKit Sidecar）';
  if (status === 'stopped') return 'sidecar 已停止';
  return '正在连接 dsh sidecar…';
}

export function Composer(props: ComposerProps): JSX.Element {
  const {
    value,
    onChange,
    onSend,
    onStop,
    busy,
    mode,
    onModeChange,
    ready,
    status,
    textareaRef,
    onSearchFiles,
    fileResults,
    queued,
  } = props;
  /** @ 提及：当前激活的提及查询（null = 未激活）。 */
  const [mention, setMention] = React.useState<{ start: number; query: string } | null>(null);
  const [pick, setPick] = React.useState(0);
  const files = fileResults ?? [];

  /** 光标前的 @token → 触发搜索。 */
  const syncMention = (text: string, caret: number): void => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at === -1) {
      setMention(null);
      return;
    }
    const token = before.slice(at + 1);
    // @ 前必须是行首/空白，token 内不能有空白
    const prev = at === 0 ? '\n' : before[at - 1];
    if (/\s/.test(token) || !/^\s?$/.test(prev.replace(/[^\s]/g, ''))) {
      setMention(null);
      return;
    }
    setMention({ start: at, query: token });
    onSearchFiles?.(token);
    setPick(0);
  };

  const applyFile = (path: string): void => {
    if (!mention) return;
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, mention.start)}@${path} ${value.slice(caret)}`;
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = mention.start + path.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

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
      {mention && files.length > 0 && (
        <div className="mention-pop" role="listbox">
          {files.map((f, i) => (
            <div
              key={f}
              role="option"
              aria-selected={i === pick}
              className={`mention-item ${i === pick ? 'active' : ''}`}
              onMouseEnter={() => setPick(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                applyFile(f);
              }}
            >
              <span className="mention-path">{f}</span>
            </div>
          ))}
        </div>
      )}
      <div className={`composer-box ${disabled ? 'disabled' : ''}`}>
        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          placeholder={placeholderFor(ready, status, mode)}
          onChange={(e) => {
            onChange(e.target.value);
            syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            // @ 提及下拉激活时接管方向键/回车/Tab/Esc
            if (mention && files.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setPick((p) => (p + 1) % files.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setPick((p) => (p - 1 + files.length) % files.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                applyFile(files[pick]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (value.trim()) onSend(); // 生成中也可发送 → 排队
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
            {Boolean(queued) && <span className="queue-chip">排队 {queued}</span>}
            <button
              className="btn-send"
              onClick={onSend}
              disabled={!value.trim() || disabled}
              title={busy ? '排队发送（当前回复结束后自动发出）' : '发送 (Enter)'}
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
