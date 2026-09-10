/**
 * Chat webview 入口（M0）：
 * - 接收扩展进程 postMessage（init / sidecarStatus / event / error）
 * - 事件源式渲染：增量文本、工具调用卡片、会话状态
 * - 发送 / 停止
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CkpEvent } from '@dsh-cursorkit/protocol';
import './chat.css';

interface SidecarStatusMsg {
  type: 'sidecarStatus';
  status: string;
  info?: { port?: number; dshVersion?: string } | null;
}
interface InitMsg {
  type: 'init';
  model: string;
  sidecar?: { port?: number; dshVersion?: string } | null;
}
interface EventMsg {
  type: 'event';
  event: CkpEvent;
}
interface ErrorMsg {
  type: 'error';
  message: string;
}
interface InfoMsg {
  type: 'info';
  message: string;
}
interface ReviewListMsg {
  type: 'review.list';
  changes: { path: string; additions: number; deletions: number; status: string }[];
}
interface CheckpointOpenMsg {
  type: 'checkpoint.open';
}
interface CheckpointListMsg {
  type: 'checkpoint.list';
  sessionId: string;
  checkpoints: {
    id: string;
    sessionId: string;
    summary: string;
    createdAt: number;
    commit?: string;
    reversible: boolean;
  }[];
}
type Inbound =
  | SidecarStatusMsg
  | InitMsg
  | EventMsg
  | ErrorMsg
  | InfoMsg
  | ReviewListMsg
  | CheckpointOpenMsg
  | CheckpointListMsg;

// --- 消息渲染模型 ---
interface ChatItem {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  toolName?: string;
  status?: string;
}

interface ReviewChange {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

interface CheckpointInfo {
  id: string;
  sessionId: string;
  summary: string;
  createdAt: number;
  commit?: string;
  reversible: boolean;
}

function App(): JSX.Element {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState<'starting' | 'ready' | 'error' | 'stopped'>('starting');
  const [model, setModel] = useState('');
  const [sidecarInfo, setSidecarInfo] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<ReviewChange[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [mode, setMode] = useState<'ask' | 'edit' | 'agent'>('agent');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const msg = ev.data as Inbound;
      switch (msg.type) {
        case 'init':
          setModel(msg.model);
          if (msg.sidecar) {
            setSidecarInfo(`pid=${msg.sidecar.port} dsh=${msg.sidecar.dshVersion ?? '?'}`);
            setConnected('ready');
          }
          break;
        case 'sidecarStatus':
          setConnected(msg.status as 'ready' | 'starting' | 'error' | 'stopped');
          if (msg.info) setSidecarInfo(`port=${msg.info.port} dsh=${msg.info.dshVersion ?? '?'}`);
          break;
        case 'event':
          handleEvent(msg.event);
          break;
        case 'error':
          pushItem({ id: `err-${Date.now()}`, role: 'system', text: `⚠️ ${msg.message}` });
          break;
        case 'info':
          pushItem({ id: `info-${Date.now()}`, role: 'system', text: msg.message });
          break;
        case 'review.list':
          setChanges(msg.changes);
          break;
        case 'checkpoint.open':
          setShowCheckpoints(true);
          post({ type: 'checkpoint.list', sessionId: '' });
          break;
        case 'checkpoint.list':
          setCheckpoints(msg.checkpoints);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  function pushItem(item: ChatItem): void {
    setItems((prev) => [...prev, item]);
    scrollBottom();
  }

  function updateItem(id: string, fn: (it: ChatItem) => ChatItem): void {
    setItems((prev) => prev.map((it) => (it.id === id ? fn(it) : it)));
  }

  function handleEvent(evt: CkpEvent): void {
    switch (evt.type) {
      case 'message.user': {
        pushItem({ id: `u-${evt.ts}`, role: 'user', text: evt.text });
        setBusy(true);
        break;
      }
      case 'message.delta': {
        const id = `a-${evt.sessionId}`;
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === id) {
            const copy = [...prev];
            copy[copy.length - 1] = { ...last, text: last.text + evt.text };
            return copy;
          }
          return [...prev, { id, role: 'assistant', text: evt.text }];
        });
        scrollBottom();
        break;
      }
      case 'thinking.delta': {
        const id = `t-${evt.sessionId}`;
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === id) {
            const copy = [...prev];
            copy[copy.length - 1] = { ...last, text: last.text + evt.text };
            return copy;
          }
          return [...prev, { id, role: 'system', text: `🤔 ${evt.text}` }];
        });
        break;
      }
      case 'tool.call': {
        let name = 'tool';
        try {
          const args = evt.call.args as Record<string, unknown>;
          name = String(args.command ?? args.path ?? args.file ?? '') || evt.call.name;
        } catch {
          name = evt.call.name ?? 'tool';
        }
        pushItem({ id: `c-${evt.call.callId}`, role: 'tool', text: name, status: 'running' });
        setBusy(true);
        break;
      }
      case 'tool.done': {
        updateItem(`c-${evt.callId}`, (it) => ({ ...it, status: evt.status === 'success' ? 'done' : 'failed' }));
        break;
      }
      case 'tool.output': {
        updateItem(`c-${evt.callId}`, (it) => ({ ...it, text: `${it.text} → ${evt.output.slice(0, 200)}` }));
        break;
      }
      case 'message.done':
        setBusy(false);
        scrollBottom();
        break;
      case 'done':
        setBusy(false);
        break;
      case 'error':
        pushItem({ id: `err-${evt.ts}`, role: 'system', text: `⚠️ ${evt.message}` });
        setBusy(false);
        break;
      case 'cancelled':
        setBusy(false);
        pushItem({ id: `canc-${evt.ts}`, role: 'system', text: '⏹ 已停止' });
        break;
      default:
        break;
    }
  }

  function scrollBottom(): void {
    setTimeout(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, 30);
  }

  function send(): void {
    const text = input.trim();
    if (!text) return;
    post({ type: 'send', text, mode });
    setInput('');
  }

  function stop(): void {
    post({ type: 'stop' });
  }

  const statusIcon =
    connected === 'ready' ? '●' : connected === 'error' ? '✕' : connected === 'stopped' ? '○' : '◌';
  const statusClass = `status-${connected}`;

  return (
    <div className="app">
      <header className="topbar">
        <span className={`dot ${statusClass}`}>{statusIcon}</span>
        <span className="title">DSH CursorKit</span>
        <button
          className="btn-review"
          onClick={() => {
            setShowReview((v) => !v);
            if (!showReview) post({ type: 'review.list' });
          }}
          title="审查 agent 改动"
        >
          {changes.length > 0 ? `改动 ${changes.length}` : '改动'}
        </button>
        <span className="model">{model}</span>
        <span className="sidecar">{sidecarInfo}</span>
      </header>

      {showReview && (
        <div className="review-panel">
          <div className="review-title">Agent 改动（点击 diff 审查，可还原）</div>
          {changes.length === 0 && <div className="review-empty">暂无改动</div>}
          {changes.map((c) => (
            <div key={c.path} className="review-item">
              <span className="review-path">{c.path}</span>
              <span className="review-stat">
                +{c.additions}/-{c.deletions}
              </span>
              <button onClick={() => post({ type: 'review.diff', path: c.path })}>diff</button>
              <button onClick={() => post({ type: 'review.reject', path: c.path })}>还原</button>
            </div>
          ))}
        </div>
      )}

      {showCheckpoints && (
        <div className="review-panel checkpoint-panel">
          <div className="review-title">Checkpoint 时间线（可回滚）</div>
          {checkpoints.length === 0 && <div className="review-empty">暂无 checkpoint（agent 改动后自动创建）</div>}
          {[...checkpoints].reverse().map((cp) => (
            <div key={cp.id} className="review-item">
              <span className="review-path">
                {new Date(cp.createdAt).toLocaleTimeString()} · {cp.summary.slice(0, 40)}
              </span>
              <span className="review-stat">{cp.commit ? cp.commit.slice(0, 7) : ''}</span>
              <button onClick={() => post({ type: 'checkpoint.restore', checkpointId: cp.id })}>回滚</button>
            </div>
          ))}
        </div>
      )}

      <div className="messages" ref={listRef}>
        {items.length === 0 && (
          <div className="empty">
            <div className="empty-title">DSH CursorKit</div>
            <div className="empty-sub">以 dsh 为内核的 AI 编程助手（Cursor 同款体验）</div>
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} className={`item item-${it.role}`}>
            {it.role === 'tool' && (
              <span className={`tool-badge ${it.status === 'running' ? 'running' : ''}`}>
                {it.status === 'running' ? '◔' : it.status === 'failed' ? '✕' : '✓'}
              </span>
            )}
            <div className="item-text">{it.text}</div>
          </div>
        ))}
      </div>

      <div className="composer">
        <textarea
          ref={inputRef}
          value={input}
          placeholder="询问代码 / 让 agent 修改（Enter 发送，Shift+Enter 换行）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="mode-bar">
          {(['ask', 'edit', 'agent'] as const).map((m) => (
            <button
              key={m}
              className={`mode-btn ${mode === m ? 'active' : ''}`}
              onClick={() => setMode(m)}
              title={
                m === 'ask'
                  ? 'Ask：只问答，不修改文件'
                  : m === 'edit'
                    ? 'Edit：聚焦修改指定内容'
                    : 'Agent：多文件自动执行'
              }
            >
              {m === 'ask' ? 'Ask' : m === 'edit' ? 'Edit' : 'Agent'}
            </button>
          ))}
        </div>
        <div className="composer-actions">
          {busy && (
            <button className="btn-stop" onClick={stop}>
              ⏹ Stop
            </button>
          )}
          <button className="btn-send" onClick={send} disabled={!input.trim() || busy}>
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

// VSCode webview 沙箱：acquireVsCodeApi 由宿主注入（panel.ts 的 HTML 加载后可用）
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = acquireVsCodeApi();

function post(msg: unknown): void {
  vscodeApi.postMessage(msg);
}

createRoot(document.getElementById('root')!).render(<App />);
