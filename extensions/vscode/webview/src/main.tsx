/**
 * Chat webview 入口。
 *
 * 修复的问题：
 * - 切换会话时不清空消息 → 与回放的旧会话历史串台
 * - 选择模型时硬编码 `wps/` 前缀 → 其它 provider 的模型选不中
 * - 流式输出时不自动滚动（依赖 items.length 不变）
 * - 新建会话不带当前选择的模型
 *
 * 新增/优化：
 * - 草稿持久化（webview state）、Esc 关闭面板、面板互斥
 * - 流式"生成中"指示、滚动到底部按钮、错误消息分级
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CkpEvent } from '@dsh-cursorkit/protocol';
import './tokens.css';
import './chat.css';
import type {
  ChatItem,
  ChatMode,
  CheckpointInfo,
  ConnectionStatus,
  ModelInfo,
  ReviewChange,
  SessionInfo,
  SettingsData,
} from './types.ts';
import { fullModelName } from './types.ts';
import { TopBar } from './components/TopBar.tsx';
import { MessageList } from './components/MessageList.tsx';
import { Composer } from './components/Composer.tsx';
import {
  SessionsPanel,
  ModelsPanel,
  ReviewPanel,
  CheckpointsPanel,
  SettingsPanel,
} from './components/panels.tsx';

// ── 入站消息 ─────────────────────────────────────────────
interface SidecarStatusMsg {
  type: 'sidecarStatus';
  status: string;
  info?: { port?: number; dshVersion?: string } | null;
}
interface InitMsg {
  type: 'init';
  model: string;
  sessionId?: string;
  sidecar?: { port?: number; dshVersion?: string } | null;
}
interface EventMsg {
  type: 'event';
  event: CkpEvent & { turn?: number; step?: number };
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
  changes: ReviewChange[];
}
interface CheckpointOpenMsg {
  type: 'checkpoint.open';
}
interface CheckpointListMsg {
  type: 'checkpoint.list';
  sessionId: string;
  checkpoints: CheckpointInfo[];
}
interface SessionListMsg {
  type: 'session.list';
  sessions: SessionInfo[];
  activeSessionId?: string;
}
interface SessionSwitchedMsg {
  type: 'session.switched';
  sessionId: string;
}
interface ModelListMsg {
  type: 'model.list';
  models: ModelInfo[];
}
interface SettingsGetMsg {
  type: 'settings.get';
  rules: SettingsData['rules'];
  config: SettingsData['config'];
}
type Inbound =
  | SidecarStatusMsg
  | InitMsg
  | EventMsg
  | ErrorMsg
  | InfoMsg
  | ReviewListMsg
  | CheckpointOpenMsg
  | CheckpointListMsg
  | SessionListMsg
  | SessionSwitchedMsg
  | ModelListMsg
  | SettingsGetMsg;

/** 面板互斥标识（同时只开一个）。 */
type PanelKind = 'sessions' | 'models' | 'review' | 'checkpoints' | 'settings' | null;

function App(): JSX.Element {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState<ConnectionStatus>('starting');
  const [model, setModel] = useState('');
  const [sidecarInfo, setSidecarInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<ReviewChange[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [mode, setMode] = useState<ChatMode>('agent');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [settingsData, setSettingsData] = useState<SettingsData | null>(null);
  const [panel, setPanel] = useState<PanelKind>(null);
  const [dismissedHint, setDismissedHint] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** 面板开关（互斥：打开一个就关掉其它）。 */
  const togglePanel = useCallback((kind: Exclude<PanelKind, null>, request?: () => void) => {
    setPanel((cur) => (cur === kind ? null : kind));
    request?.();
  }, []);

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const msg = ev.data as Inbound;
      switch (msg.type) {
        case 'init':
          setModel(msg.model);
          if (msg.sessionId) setActiveSessionId(msg.sessionId);
          if (msg.sidecar) {
            setSidecarInfo(`:${msg.sidecar.port} · dsh ${msg.sidecar.dshVersion ?? '?'}`);
            setConnected('ready');
          }
          break;
        case 'sidecarStatus':
          setConnected(msg.status as ConnectionStatus);
          if (msg.info) setSidecarInfo(`:${msg.info.port} · dsh ${msg.info.dshVersion ?? '?'}`);
          break;
        case 'event':
          handleEvent(msg.event);
          break;
        case 'error':
          pushItem({ id: `err-${Date.now()}`, role: 'system', text: msg.message, level: 'error' });
          break;
        case 'info':
          pushItem({ id: `info-${Date.now()}`, role: 'system', text: msg.message });
          break;
        case 'review.list':
          setChanges(msg.changes);
          break;
        case 'checkpoint.open':
          setPanel('checkpoints');
          post({ type: 'checkpoint.list', sessionId: '' });
          break;
        case 'checkpoint.list':
          setCheckpoints(msg.checkpoints);
          break;
        case 'session.list':
          setSessions(msg.sessions);
          if (msg.activeSessionId) setActiveSessionId(msg.activeSessionId);
          break;
        case 'session.switched':
          // 修复：切换/新建会话必须清空消息，否则与回放的历史串台
          setItems([]);
          setBusy(false);
          setActiveSessionId(msg.sessionId);
          post({ type: 'checkpoint.list', sessionId: msg.sessionId });
          break;
        case 'model.list':
          setModels(msg.models);
          break;
        case 'settings.get':
          setSettingsData({ rules: msg.rules, config: msg.config });
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // 草稿持久化（VSCode webview state，面板隐藏/重开不丢）
  useEffect(() => {
    const saved = vscodeApi.getState() as { draft?: string; mode?: ChatMode } | undefined;
    if (saved?.draft) setInput(saved.draft);
    if (saved?.mode) setMode(saved.mode);
  }, []);
  useEffect(() => {
    vscodeApi.setState({ draft: input, mode });
  }, [input, mode]);

  // Esc 关闭面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panel) {
        e.stopPropagation();
        setPanel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  function pushItem(item: ChatItem): void {
    setItems((prev) => [...prev, { ts: Date.now(), ...item }]);
  }

  function updateItem(id: string, fn: (it: ChatItem) => ChatItem): void {
    setItems((prev) => prev.map((it) => (it.id === id ? fn(it) : it)));
  }

  function handleEvent(evt: CkpEvent): void {
    switch (evt.type) {
      case 'message.user':
        // 用户消息自身无轮次标记（dsh 的 user/message 不带 turn）→ 独立成组
        pushItem({ id: `u-${evt.ts}`, role: 'user', text: evt.text });
        setBusy(true);
        break;
      case 'message.delta': {
        // 按 turn/step 归组：同一轮的文本持续追加到同一条，跨轮不会混
        const id = `a-${evt.sessionId}-${evt.turn ?? 'x'}-${evt.step ?? 'x'}`;
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === id) {
            const copy = [...prev];
            copy[copy.length - 1] = { ...last, text: last.text + evt.text };
            return copy;
          }
          return [
            ...prev,
            { id, role: 'assistant', text: evt.text, ts: evt.ts, turn: evt.turn, step: evt.step },
          ];
        });
        break;
      }
      case 'thinking.delta': {
        // thinking 也按 turn/step 分段（此前同一会话的思考会被并成一块）
        const id = `t-${evt.sessionId}-${evt.turn ?? 'x'}-${evt.step ?? 'x'}`;
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === id) {
            const copy = [...prev];
            copy[copy.length - 1] = { ...last, text: last.text + evt.text };
            return copy;
          }
          return [
            ...prev,
            { id, role: 'thinking', text: evt.text, ts: evt.ts, turn: evt.turn, step: evt.step },
          ];
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
        pushItem({
          id: `c-${evt.call.callId}`,
          role: 'tool',
          text: name,
          status: 'running',
          turn: evt.turn,
          step: evt.step,
        });
        setBusy(true);
        break;
      }
      case 'tool.done':
        updateItem(`c-${evt.callId}`, (it) => ({
          ...it,
          status: evt.status === 'success' ? 'done' : 'failed',
        }));
        break;
      case 'tool.output':
        updateItem(`c-${evt.callId}`, (it) => ({
          ...it,
          output: `${it.output ?? ''}${it.output ? '\n' : ''}${evt.output}`,
        }));
        break;
      case 'message.done':
      case 'done':
        setBusy(false);
        break;
      case 'error':
        pushItem({ id: `err-${evt.ts}`, role: 'system', text: evt.message, level: 'error' });
        setBusy(false);
        break;
      case 'cancelled':
        setBusy(false);
        pushItem({ id: `canc-${evt.ts}`, role: 'system', text: '已停止', level: 'stopped' });
        break;
      default:
        break;
    }
  }

  function send(): void {
    const text = input.trim();
    if (!text) return;
    post({ type: 'send', text, mode, model });
    setInput('');
    inputRef.current?.focus();
  }

  const modelLabel = useMemo(() => model.split('/').pop() || model, [model]);

  return (
    <div className="app">
      <TopBar
        status={connected}
        model={modelLabel}
        sidecarInfo={sidecarInfo}
        activeSessionId={activeSessionId}
        changesCount={changes.length}
        activePanel={panel}
        onToggleSessions={() => togglePanel('sessions', () => post({ type: 'session.list' }))}
        onNewSession={() => post({ type: 'newSession', model })}
        onToggleReview={() => togglePanel('review', () => post({ type: 'review.list' }))}
        onToggleModels={() => togglePanel('models', () => post({ type: 'model.list' }))}
        onToggleSettings={() => togglePanel('settings', () => post({ type: 'settings.get' }))}
        onToggleCheckpoints={() => togglePanel('checkpoints', () => post({ type: 'checkpoint.list', sessionId: '' }))}
      />

      {panel === 'sessions' && (
        <SessionsPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitch={(id) => {
            post({ type: 'session.switch', sessionId: id });
            setPanel(null);
          }}
          onNew={() => {
            post({ type: 'newSession', model });
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'models' && (
        <ModelsPanel
          models={models}
          current={model}
          onSelect={(m) => {
            setModel(fullModelName(m));
            setPanel(null);
            pushItem({
              id: `info-${Date.now()}`,
              role: 'system',
              text: `已切换到 ${fullModelName(m)}（下一条消息生效）`,
            });
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'review' && (
        <ReviewPanel
          changes={changes}
          onDiff={(path) => post({ type: 'review.diff', path })}
          onReject={(path) => post({ type: 'review.reject', path })}
          onOpen={(path) => post({ type: 'review.open', path })}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'checkpoints' && (
        <CheckpointsPanel
          checkpoints={checkpoints}
          onRollback={(id) => post({ type: 'checkpoint.restore', checkpointId: id })}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'settings' && (
        <SettingsPanel
          data={settingsData}
          onToggleTab={() => {
            if (!settingsData) return;
            const next = !settingsData.config.tabEnabled;
            post({ type: 'settings.update', patch: { tabEnabled: next } });
            setSettingsData({
              ...settingsData,
              config: { ...settingsData.config, tabEnabled: next },
            });
          }}
          onClose={() => setPanel(null)}
        />
      )}

      <MessageList items={items} busy={busy} />

      {!dismissedHint && items.length === 0 && (
        <div className="hints">
          {[
            '解释这个项目的架构',
            '给选中的函数加错误处理',
            '找出可能导致内存泄漏的地方',
          ].map((h) => (
            <button
              key={h}
              className="hint-chip"
              onClick={() => {
                setInput(h);
                inputRef.current?.focus();
                setDismissedHint(true);
              }}
            >
              {h}
            </button>
          ))}
        </div>
      )}

      <Composer
        value={input}
        onChange={setInput}
        onSend={send}
        onStop={() => {
          // 立即解锁 UI（后端会再发 cancelled/done 事件；这里只求"点了就有反馈"）
          setBusy(false);
          pushItem({ id: `stopping-${Date.now()}`, role: 'system', text: '正在停止…' });
          post({ type: 'stop' });
        }}
        busy={busy}
        mode={mode}
        onModeChange={setMode}
        ready={connected === 'ready'}
        status={connected}
        textareaRef={inputRef}
      />
    </div>
  );
}

// VSCode webview 沙箱：acquireVsCodeApi 由宿主注入
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

declare global {
  interface Window {
    /** 由 HTML bootstrap 注入（VSCode 只允许 acquireVsCodeApi 调用一次）。 */
    __dshApi?: { postMessage(msg: unknown): void; getState(): unknown; setState(state: unknown): void };
  }
}

const vscodeApi = window.__dshApi ?? acquireVsCodeApi();

function post(msg: unknown): void {
  vscodeApi.postMessage(msg);
}

createRoot(document.getElementById('root')!).render(<App />);

// 渲染完成回报（扩展侧写入 activity.log）→ 白屏时能立刻区分"没跑起来"与"跑了但没内容"
queueMicrotask(() => {
  try {
    const root = document.getElementById('root');
    vscodeApi.postMessage({
      type: 'webviewReady',
      nodes: root ? root.querySelectorAll('*').length : -1,
    });
  } catch {
    /* ignore */
  }
});
