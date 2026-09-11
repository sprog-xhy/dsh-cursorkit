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
import { MessageList, groupByTurn } from './components/MessageList.tsx';
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
interface ReviewAcceptedMsg {
  type: 'review.accepted';
  path: string;
}
interface ReviewRevertedMsg {
  type: 'review.reverted';
  path: string;
}
interface FilesResultMsg {
  type: 'files.result';
  query: string;
  files: string[];
  error?: string;
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
  | ReviewAcceptedMsg
  | ReviewRevertedMsg
  | FilesResultMsg
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
  /** sessionId → 标题（来自 session.list 与 session.title 事件）。 */
  const [titles, setTitles] = useState<Record<string, string>>({});
  /** @ 提及候选（来自扩展的文件搜索）。 */
  const [fileResults, setFileResults] = useState<string[]>([]);
  /** 生成中排队的消息（回复结束后自动发出）。 */
  const [queue, setQueue] = useState<{ text: string; mode: ChatMode }[]>([]);
  /** 删除会话时是否连带删除磁盘日志（用户选择）。 */
  const [deleteFiles, setDeleteFiles] = useState(false);
  /** 最近一条用户输入（供"重新生成"）。 */
  const lastUserRef = useRef('');
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
        case 'review.accepted': {
          const p = (msg as { path?: string }).path ?? '';
          setItems((prev) =>
            prev.map((it) =>
              it.role === 'change' && it.path === p ? { ...it, changeState: 'accepted' } : it,
            ),
          );
          break;
        }
        case 'review.reverted': {
          const p = (msg as { path?: string }).path ?? '';
          setItems((prev) =>
            prev.map((it) =>
              it.role === 'change' && it.path === p ? { ...it, changeState: 'reverted' } : it,
            ),
          );
          break;
        }
        case 'files.result': {
          setFileResults(Array.isArray((msg as { files?: string[] }).files) ? ((msg as { files?: string[] }).files as string[]) : []);
          break;
        }
        case 'session.list': {
          setSessions(msg.sessions);
          setTitles((prev) => {
            const next = { ...prev };
            for (const s of msg.sessions) {
              if (s.summary?.trim()) next[s.id] = s.summary.trim();
            }
            return next;
          });
          if (msg.activeSessionId) setActiveSessionId(msg.activeSessionId);
          break;
        }
        case 'session.switched':
          // 修复：切换/新建会话必须清空消息，否则与回放的历史串台
          setItems([]);
          post({ type: 'session.list' });
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
      case 'message.user': {
        // 用户消息自身无轮次标记（dsh 的 user/message 不带 turn）→ 独立成组
        lastUserRef.current = evt.text;
        const mid = (evt as unknown as { messageId?: string }).messageId;
        setItems((prev) => {
          // 防御：同一条消息（乐观事件 + 日志事件）只渲染一次
          if (mid && prev.some((it) => it.messageId === mid)) return prev;
          return [...prev, { id: `u-${mid ?? evt.ts}`, role: 'user', text: evt.text, messageId: mid, ts: evt.ts }];
        });
        setBusy(true);
        break;
      }
      case 'message.delta': {
        // 空增量直接忽略：否则会在前端留下一个空白助手气泡
        if (!evt.text) break;
        // 按 turn/step 归组：同一轮的文本持续追加到同一条，跨轮不会混
        const id = `a-${evt.sessionId}-${evt.turn ?? 'x'}-${evt.step ?? 'x'}`;
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === id) {
            const copy = [...prev];
            copy[copy.length - 1] = {
              ...last,
              text: last.text + evt.text,
              retryText: last.retryText || lastUserRef.current,
            };
            return copy;
          }
          return [
            ...prev,
            {
              id,
              role: 'assistant',
              text: evt.text,
              ts: evt.ts,
              turn: evt.turn,
              step: evt.step,
              retryText: lastUserRef.current,
            },
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
            copy[copy.length - 1] = {
              ...last,
              text: last.text + evt.text,
              retryText: last.retryText || lastUserRef.current,
            };
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
          // 防御：tool.output 是终态输出（若 host 未补发 tool.done，卡片也不该卡在"运行中"）
          status: it.status === 'failed' ? 'failed' : 'done',
        }));
        break;
      case 'file.changed': {
        const c = (evt as unknown as { change?: { path: string; additions: number; deletions: number; status: string } }).change;
        if (c?.path) {
          pushItem({
            id: `chg-${c.path}-${evt.ts}`,
            role: 'change',
            text: c.path,
            path: c.path,
            additions: c.additions ?? 0,
            deletions: c.deletions ?? 0,
            status: c.status,
            changeState: 'pending',
            ts: evt.ts,
          });
        }
        break;
      }
      case 'session.title': {
        const t = (evt as unknown as { title?: string }).title ?? '';
        if (t) setTitles((prev) => ({ ...prev, [evt.sessionId]: t }));
        break;
      }
      case 'message.done':
      case 'done':
        setBusy(false);
        flushQueue();
        break;
      case 'error':
        pushItem({ id: `err-${evt.ts}`, role: 'system', text: evt.message, level: 'error' });
        setBusy(false);
        break;
      case 'cancelled':
        setBusy(false);
        flushQueue();
        pushItem({ id: `canc-${evt.ts}`, role: 'system', text: '已停止', level: 'stopped' });
        break;
      default:
        break;
    }
  }

  function send(): void {
    const text = input.trim();
    if (!text) return;
    if (busy) {
      // 生成中 → 排队（Cursor 行为：当前回复结束后自动发出）
      setQueue((q) => [...q, { text, mode }]);
      pushItem({ id: `q-${Date.now()}`, role: 'system', text: `已排队（第 ${queue.length + 1} 条）` });
      setInput('');
      return;
    }
    lastUserRef.current = text;
    post({ type: 'send', text, mode, model });
    setInput('');
    inputRef.current?.focus();
  }

  /** 回复结束 → 发送排队中的下一条。 */
  function flushQueue(): void {
    setQueue((q) => {
      if (q.length === 0) return q;
      const [next, ...rest] = q;
      // 用最新输入框内容不改动用户正在编辑的文本：直接发送排队的文本
      setTimeout(() => post({ type: 'send', text: next.text, mode: next.mode, model }), 0);
      return rest;
    });
  }

  /**
   * 每条助手消息组 → 可回滚的 checkpoint。
   * 语义：取"该消息之后最早出现的 checkpoint"（回滚即撤销其后的所有改动）。
   */
  const checkpointByGroup = useMemo(() => {
    const map: Record<string, string> = {};
    const groups = groupByTurn(items);
    for (const g of groups) {
      const ts = g.items[g.items.length - 1]?.ts ?? 0;
      const after = checkpoints
        .filter((c) => c.createdAt >= ts)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (after) map[g.key] = after.id;
    }
    return map;
  }, [items, checkpoints]);

  const modelLabel = useMemo(() => model.split('/').pop() || model, [model]);

  return (
    <div className="app">
      <TopBar
        status={connected}
        model={modelLabel}
        sidecarInfo={sidecarInfo}
        activeSessionId={activeSessionId}
        activeSessionLabel={titles[activeSessionId] ?? ''}
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
          onRename={(id, title) => post({ type: 'session.rename', sessionId: id, title })}
          onDelete={(id, withFiles) => post({ type: 'session.delete', sessionId: id, deleteFiles: withFiles })}
          deleteFiles={deleteFiles}
          onToggleDeleteFiles={setDeleteFiles}
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
        onKeep={(path) => post({ type: 'review.accept', path })}
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

      <MessageList
        items={items}
        busy={busy}
        onDiff={(path) => post({ type: 'review.diff', path })}
        onRevert={(path) => post({ type: 'review.reject', path })}
        onOpen={(path) => post({ type: 'review.open', path })}
        onKeep={(path) => post({ type: 'review.accept', path })}
        onRetry={(text) => {
          lastUserRef.current = text;
          post({ type: 'send', text, mode, model });
        }}
        onEdit={(text) => {
          setInput(text);
          inputRef.current?.focus();
        }}
        checkpointByGroup={checkpointByGroup}
        onRestore={(id) => {
          post({ type: 'checkpoint.restore', checkpointId: id });
          pushItem({ id: `rs-${Date.now()}`, role: 'system', text: '正在回滚到该 checkpoint…' });
        }}
      />

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
        onSearchFiles={(q) => post({ type: 'files.search', query: q })}
        fileResults={fileResults}
        queued={queue.length}
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
