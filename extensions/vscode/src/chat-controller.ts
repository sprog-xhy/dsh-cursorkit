/**
 * Chat 控制器（修复：面板与侧边栏视图各自持有状态、侧边栏视图渲染为空）。
 *
 * 一个控制器持有 ckp / sidecar / 改动跟踪 / 规则去重等共享状态，
 * 多个 webview 宿主（编辑器面板 + 活动栏侧边栏视图）挂到同一个控制器上：
 * - 事件、状态、改动列表向所有宿主广播
 * - 任一宿主发来的消息都由同一套逻辑处理
 */
import * as vscode from 'vscode';
import type { CkpService } from './ckp.ts';
import type { SidecarManager } from './sidecar.ts';
import { buildInjectedContext, formatSelectionBlock, currentWorkspace } from './ide-bridge.ts';
import { ChangeTracker, rejectChange, resolveConflict, type FileChangeEvent } from './review.ts';
import { loadRules, rulesToPrompt, rulesFingerprint } from './rules.ts';
import type { VirtualDocProvider } from './virtual-docs.ts';
import { relative } from 'node:path';

/** webview 宿主（编辑器面板 / 侧边栏视图）。 */
export interface ChatHost {
  readonly hostId: string;
  readonly context: vscode.ExtensionContext;
  readonly webview: vscode.Webview;
  post(msg: unknown): void;
  /** 宿主标题（诊断用）。 */
  readonly kind: 'panel' | 'view';
}

export class ChatController {
  private readonly hosts = new Set<ChatHost>();
  private readonly tracker: ChangeTracker;
  private readonly disposables: vscode.Disposable[] = [];
  /** 已注入 rules 的会话 → 内容指纹（避免每条消息重复注入）。 */
  private readonly rulesSent = new Map<string, string>();
  /** 会话集合变化（供侧边栏会话树刷新）。 */
  readonly onDidChangeSessions = new vscode.EventEmitter<void>();

  constructor(
    private readonly ckp: CkpService,
    private readonly sidecar: SidecarManager,
    private readonly docs: VirtualDocProvider,
    readonly extensionContext: vscode.ExtensionContext,
  ) {
    this.tracker = new ChangeTracker(docs);
    // 事件流 → 广播给所有宿主
    this.disposables.push(
      toDisposable(
        ckp.onEvent((evt) => {
          this.broadcast({ type: 'event', event: evt });
          void this.onEventSideEffect(evt);
        }),
      ),
    );
    // sidecar 状态 → 广播
    this.disposables.push(
      toDisposable(
        sidecar.onStatusChange((status, info) => {
          this.broadcast({ type: 'sidecarStatus', status, info: info ?? sidecar.runtimeInfo });
        }),
      ),
    );
  }

  /** 挂载 webview 宿主并推送初始状态。 */
  attach(host: ChatHost): void {
    this.hosts.add(host);
    host.post({
      type: 'init',
      model: this.defaultModel(),
      sidecar: this.sidecar.runtimeInfo,
      sessionId: this.ckp.sessionId ?? '',
    });
    host.post({ type: 'review.list', changes: this.tracker.list() });
  }

  detach(host: ChatHost): void {
    this.hosts.delete(host);
  }

  get hostCount(): number {
    return this.hosts.size;
  }

  /** 扩展根 URI（宿主渲染 webview 资源用）。 */
  get extensionUri(): vscode.Uri {
    return this.extensionContext.extensionUri;
  }

  /** 向所有宿主广播。 */
  broadcast(msg: unknown): void {
    for (const host of this.hosts) {
      try {
        host.post(msg);
      } catch {
        /* 宿主已销毁：忽略 */
      }
    }
  }

  /** 处理来自某个宿主的消息。 */
  async handleMessage(msg: { type: string; [k: string]: unknown }, host: ChatHost): Promise<void> {
    switch (msg.type) {
      case 'send':
        return this.onSend(msg);
      case 'stop':
        await this.ckp.cancel().catch(() => undefined);
        return;
      case 'newSession':
        return this.onNewSession(msg);
      case 'session.switch': {
        const id = String(msg.sessionId ?? '');
        if (!id) return;
        try {
          // 顺序很重要：先让前端清空，再回放历史（否则历史会被清掉）
          this.broadcast({ type: 'session.switched', sessionId: id });
          const restored = await this.ckp.switchSession(id);
          if (restored > 0) {
            this.broadcast({ type: 'info', message: `已恢复 ${restored} 条历史事件` });
          }
          this.onDidChangeSessions.fire();
        } catch (err) {
          this.broadcast({ type: 'error', message: `切换会话失败: ${(err as Error).message}` });
        }
        return;
      }
      case 'session.list':
        return this.onSessionList();
      case 'model.list':
        return this.onModelList();
      case 'settings.get':
        return this.onSettingsGet();
      case 'settings.update':
        return this.onSettingsUpdate(msg);
      case 'review.list':
        this.broadcast({ type: 'review.list', changes: this.tracker.list() });
        return;
      case 'review.diff':
        return this.onReviewDiff(String(msg.path ?? ''));
      case 'review.reject':
        return this.onReviewReject(String(msg.path ?? ''));
      case 'review.open': {
        const p = String(msg.path ?? '');
        if (!p) return;
        const abs = p.startsWith('/') ? p : `${currentWorkspace()}/${p}`;
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(abs));
        return;
      }
      case 'checkpoint.list':
        return this.onCheckpointList(msg);
      case 'checkpoint.restore':
        return this.onCheckpointRestore(String(msg.checkpointId ?? ''));
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'dshCursorkit');
        return;
      default:
        return;
    }
  }

  /** 清理（扩展停用时调用）。 */
  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.onDidChangeSessions.dispose();
    this.hosts.clear();
    this.rulesSent.clear();
  }

  // ── 消息处理 ────────────────────────────────────────────

  private async onSend(msg: { [k: string]: unknown }): Promise<void> {
    const text = String(msg.text ?? '');
    if (!text.trim()) return;
    if (!this.ckp.ready) {
      this.broadcast({ type: 'error', message: 'sidecar 未就绪，请稍候再试' });
      return;
    }
    try {
      const workspace = currentWorkspace();
      const selectedModel = String(msg.model ?? '').trim() || this.defaultModel();
      const session = await this.ckp.ensureSession(workspace, selectedModel);

      // 上下文注入（D18）：@file 提及 + 当前选中（真正拼进消息）
      const ctx = buildInjectedContext(text, workspace);
      const segments: string[] = [text];
      if (ctx.selection) {
        segments.push(formatSelectionBlock(ctx.selection));
        this.broadcast({
          type: 'info',
          message: `已附加选中代码（${ctx.selection.file} · ${ctx.selection.text.length} 字符）`,
        });
      }

      // Rules 注入（D12）：仅首次 / 内容变化时注入，避免每条消息重复计费
      const activeRel = activeFileRel(workspace);
      const rules = loadRules(workspace);
      const fingerprint = rulesFingerprint(rules);
      if (this.rulesSent.get(session.id) !== fingerprint) {
        const rulesText = rulesToPrompt(rules, activeRel);
        if (rulesText) {
          segments.push(rulesText);
          this.rulesSent.set(session.id, fingerprint);
        } else {
          this.rulesSent.set(session.id, '');
        }
      }

      await this.ckp.sendMessage(segments.join(''), {
        mentions: ctx.mentions,
        mode: (msg.mode as 'ask' | 'edit' | 'agent') ?? 'agent',
      });
    } catch (err) {
      this.broadcast({ type: 'error', message: (err as Error).message });
    }
  }

  private async onNewSession(msg: { [k: string]: unknown }): Promise<void> {
    await this.requestNewSession(typeof msg.model === 'string' ? msg.model : undefined);
  }

  /** 新建会话（命令与 webview 共用）。 */
  async requestNewSession(model?: string): Promise<void> {
    if (!this.ckp.ready) {
      this.broadcast({ type: 'error', message: 'sidecar 未就绪，请稍候再试' });
      return;
    }
    try {
      const workspace = currentWorkspace();
      const session = await this.ckp.newSession(workspace, model?.trim() || this.defaultModel());
      this.rulesSent.delete(session.id);
      this.broadcast({ type: 'session.switched', sessionId: session.id });
      this.broadcast({ type: 'info', message: `已新建会话 ${session.id.slice(0, 8)}` });
      this.onDidChangeSessions.fire();
    } catch (err) {
      this.broadcast({ type: 'error', message: `新建会话失败: ${(err as Error).message}` });
    }
  }

  private async onSessionList(): Promise<void> {
    try {
      const sessions = await this.ckp.listSessions();
      this.broadcast({ type: 'session.list', sessions, activeSessionId: this.ckp.sessionId ?? '' });
    } catch (err) {
      this.broadcast({ type: 'error', message: `会话列表读取失败: ${(err as Error).message}` });
    }
  }

  private async onModelList(): Promise<void> {
    try {
      const models = await this.ckp.listModels();
      this.broadcast({ type: 'model.list', models });
    } catch (err) {
      this.broadcast({ type: 'error', message: `模型列表读取失败: ${(err as Error).message}` });
    }
  }

  private async onSettingsGet(): Promise<void> {
    const rules = loadRules(currentWorkspace());
    this.broadcast({
      type: 'settings.get',
      rules: { global: rules.global, project: rules.project.map((r) => ({ name: r.name, globs: r.globs })) },
      config: {
        permissionMode: vscode.workspace
          .getConfiguration('dshCursorkit.permission')
          .get('mode', 'danger-full-access'),
        tabEnabled: vscode.workspace.getConfiguration('dshCursorkit.tab').get('enabled', true),
      },
    });
  }

  private async onSettingsUpdate(msg: { [k: string]: unknown }): Promise<void> {
    const patch = (msg.patch ?? {}) as Record<string, unknown>;
    try {
      if (typeof patch.tabEnabled === 'boolean') {
        await vscode.workspace
          .getConfiguration('dshCursorkit.tab')
          .update('enabled', patch.tabEnabled, vscode.ConfigurationTarget.Global);
      }
      if (typeof patch.permissionMode === 'string') {
        await vscode.workspace
          .getConfiguration('dshCursorkit.permission')
          .update('mode', patch.permissionMode, vscode.ConfigurationTarget.Global);
      }
      this.broadcast({ type: 'info', message: '设置已更新' });
      await this.onSettingsGet();
    } catch (err) {
      this.broadcast({ type: 'error', message: `设置更新失败: ${(err as Error).message}` });
    }
  }

  private async onReviewDiff(path: string): Promise<void> {
    if (!path) return;
    try {
      const outcome = await this.tracker.showDiff(path, currentWorkspace());
      if (outcome === 'patch') {
        this.broadcast({ type: 'info', message: `${path} 未纳入 git，已打开补丁视图` });
      } else if (outcome === 'not-found') {
        this.broadcast({ type: 'error', message: `无法打开 ${path} 的差异（文件不存在或已还原）` });
      }
    } catch (err) {
      this.broadcast({ type: 'error', message: `打开差异失败: ${(err as Error).message}` });
    }
  }

  private async onReviewReject(path: string): Promise<void> {
    if (!path) return;
    try {
      const outcome = await rejectChange(path, currentWorkspace(), this.docs);
      switch (outcome) {
        case 'reverted':
          this.tracker.remove(path);
          this.broadcast({ type: 'review.list', changes: this.tracker.list() });
          this.broadcast({ type: 'info', message: `已还原 ${path}` });
          break;
        case 'deleted':
          this.tracker.remove(path);
          this.broadcast({ type: 'review.list', changes: this.tracker.list() });
          this.broadcast({ type: 'info', message: `已删除新建文件 ${path}` });
          break;
        case 'cancelled':
          break;
        default:
          this.broadcast({ type: 'error', message: `还原 ${path} 失败` });
      }
    } catch (err) {
      this.broadcast({ type: 'error', message: `还原失败: ${(err as Error).message}` });
    }
  }

  private async onCheckpointList(msg: { [k: string]: unknown }): Promise<void> {
    const sessionId = String(msg.sessionId ?? '') || this.ckp.sessionId || '';
    if (!sessionId || !this.ckp.ready) {
      this.broadcast({ type: 'checkpoint.list', sessionId, checkpoints: [] });
      return;
    }
    try {
      const checkpoints = await this.ckp.checkpointList(sessionId);
      this.broadcast({ type: 'checkpoint.list', sessionId, checkpoints });
    } catch (err) {
      this.broadcast({ type: 'error', message: `checkpoint 读取失败: ${(err as Error).message}` });
    }
  }

  private async onCheckpointRestore(checkpointId: string): Promise<void> {
    if (!checkpointId || !this.ckp.ready) return;
    try {
      await this.ckp.checkpointRestore(checkpointId);
      this.broadcast({ type: 'info', message: `已回滚到 checkpoint ${checkpointId.slice(0, 8)}` });
    } catch (err) {
      this.broadcast({ type: 'error', message: `回滚失败: ${(err as Error).message}` });
    }
  }

  // ── 副作用 ──────────────────────────────────────────────

  /** 事件副作用：file.changed → 更新审查列表 + 冲突检测（D28）。 */
  private async onEventSideEffect(evt: unknown): Promise<void> {
    const e = evt as { type?: string; change?: FileChangeEvent };
    if (e?.type !== 'file.changed' || !e.change) return;
    const workspace = currentWorkspace();
    const conflict = this.tracker.handleFileChanged(e.change, workspace);
    this.broadcast({ type: 'review.list', changes: this.tracker.list() });
    if (conflict) {
      const choice = await resolveConflict(conflict, workspace, this.tracker);
      if (choice === 'keep') {
        this.broadcast({
          type: 'info',
          message: `${conflict.path} 保留了你的未保存修改（agent 版本在磁盘上）`,
        });
      }
    }
  }

  private defaultModel(): string {
    return vscode.workspace
      .getConfiguration('dshCursorkit.chat')
      .get<string>('defaultModel', 'wps/moonshot/kimi-k2.7-code');
  }
}

/** 当前活动文件的 workspace 相对路径（rules globs 过滤用）。 */
function activeFileRel(workspace: string): string | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (!uri) return undefined;
  const rel = relative(workspace, uri.fsPath);
  return rel && !rel.startsWith('..') ? rel : undefined;
}

function toDisposable(dispose: () => void): vscode.Disposable {
  return { dispose };
}