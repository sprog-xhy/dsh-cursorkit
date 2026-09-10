/**
 * Chat webview 入口（阶段三产物）。
 * 消息协议接线逻辑不变（handoff §1.3 禁止改动协议）；
 * UI 由拆分后的组件组装：TopBar + 五个 Panel + MessageList + Composer。
 */
import React, { useEffect, useRef, useState } from 'react';
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

// --- 入站消息类型（与 panel.ts 协议一致，禁止改动） ---
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
  rules: { global: string; project: string[] };
  config: { permissionMode: string; tabEnabled: boolean };
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

function App(): JSX.Element {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState<ConnectionStatus>('starting');
  const [model, setModel] = useState('');
  const [sidecarInfo, setSidecarInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<ReviewChange[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [mode, setMode] = useState<ChatMode>('agent');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [showSessions, setShowSessions] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsData, setSettingsData] = useState<SettingsData | null>(null);
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
          setConnected(msg.status as ConnectionStatus);
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
        case 'session.list':
          setSessions(msg.sessions);
          break;
        case 'session.switched':
          setActiveSessionId(msg.sessionId);
          post({ type: 'checkpoint.list', sessionId: msg.sessionId });
          break;
        case 'model.list':
          setModels(msg.models);
          break;
        case 'settings.get':
          setSettingsData(msg);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  function pushItem(item: ChatItem): void {
    setItems((prev) => [...prev, item]);
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
          return [...prev, { id, role: 'system', text: `思考: ${evt.text}` }];
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
        updateItem(`c-${evt.callId}`, (it) => ({
          ...it,
          status: evt.status === 'success' ? 'done' : 'failed',
        }));
        break;
      }
      case 'tool.output': {
        updateItem(`c-${evt.callId}`, (it) => ({
          ...it,
          toolName: `${it.toolName ?? ''}${it.toolName ? '\n' : ''}${evt.output.slice(0, 500)}`,
        }));
        break;
      }
      case 'message.done':
        setBusy(false);
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

  function send(): void {
    const text = input.trim();
    if (!text) return;
    post({ type: 'send', text, mode, model });
    setInput('');
    if (inputRef.current) inputRef.current.focus();
  }

  function stop(): void {
    post({ type: 'stop' });
  }

  return (
    <div className="app">
      <TopBar
        status={connected}
        model={model}
        sidecarInfo={sidecarInfo}
        activeSessionId={activeSessionId}
        changesCount={changes.length}
        onToggleSessions={() => {
          setShowSessions((v) => !v);
          post({ type: 'session.list' });
        }}
        onNewSession={() => post({ type: 'newSession' })}
        onToggleReview={() => {
          setShowReview((v) => !v);
          if (!showReview) post({ type: 'review.list' });
        }}
        onToggleModels={() => {
          setShowModels((v) => !v);
          if (!showModels) post({ type: 'model.list' });
        }}
        onToggleSettings={() => {
          setShowSettings((v) => !v);
          if (!showSettings) post({ type: 'settings.get' });
        }}
      />

      {showSessions && (
        <SessionsPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitch={(id) => post({ type: 'session.switch', sessionId: id })}
          onNew={() => post({ type: 'newSession' })}
          onClose={() => setShowSessions(false)}
        />
      )}
      {showModels && (
        <ModelsPanel
          models={models}
          onSelect={(id) => {
            setModel(`wps/${id}`);
            setShowModels(false);
          }}
          onClose={() => setShowModels(false)}
        />
      )}
      {showReview && (
        <ReviewPanel
          changes={changes}
          onDiff={(path) => post({ type: 'review.diff', path })}
          onReject={(path) => post({ type: 'review.reject', path })}
          onClose={() => setShowReview(false)}
        />
      )}
      {showCheckpoints && (
        <CheckpointsPanel
          checkpoints={checkpoints}
          onRollback={(id) => post({ type: 'checkpoint.restore', checkpointId: id })}
          onClose={() => setShowCheckpoints(false)}
        />
      )}
      {showSettings && settingsData && (
        <SettingsPanel
          data={settingsData}
          onToggleTab={() => {
            const next = !settingsData.config.tabEnabled;
            post({ type: 'settings.update', patch: { tabEnabled: next } });
            setSettingsData({ ...settingsData, config: { ...settingsData.config, tabEnabled: next } });
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      <MessageList items={items} />

      <Composer
        value={input}
        onChange={setInput}
        onSend={send}
        onStop={stop}
        busy={busy}
        mode={mode}
        onModeChange={setMode}
      />
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
