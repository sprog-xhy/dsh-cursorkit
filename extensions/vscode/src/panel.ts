/**
 * Chat webview 面板（V2-DECISIONS D5/D6/D7）。
 *
 * webview(React) ←postMessage→ 扩展进程(CkpService) ←CKP→ sidecar
 *
 * M0 范围：打开面板 / 创建或复用会话 / 发送 / 停止 /
 * 消息流实时渲染（session.delta / tool.call / message.done 等）。
 */
import * as vscode from 'vscode';
import { CkpService } from './ckp.ts';
import { SidecarManager } from './sidecar.ts';
import { buildInjectedContext } from './ide-bridge.ts';
import { ChangeTracker, rejectChange, type FileChangeEvent } from './review.ts';

export class ChatPanel {
  public static current: ChatPanel | null = null;

  private readonly panel: vscode.WebviewPanel;
  private readonly ckp: CkpService;
  private readonly tracker: ChangeTracker;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext, ckp: CkpService, sidecar: SidecarManager) {
    this.ckp = ckp;
    this.tracker = new ChangeTracker();
    this.panel = vscode.window.createWebviewPanel(
      'dshCursorkit.chat',
      'DSH CursorKit',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
      },
    );
    this.panel.webview.html = this.renderHtml(context, this.panel.webview);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => void this.handleMessage(msg),
      null,
      this.disposables,
    );

    // sidecar 状态变化 → 通知 webview
    sidecar.onStatusChange = (status, info) => {
      void this.post({ type: 'sidecarStatus', status, info });
    };

    // CKP 事件流 → 转发 webview；file.changed 同时驱动 IDE 审查闭环（M1b）
    ckp.onEvent((evt) => {
      void this.post({ type: 'event', event: evt });
      if (evt && typeof evt === 'object' && (evt as { type?: string }).type === 'file.changed') {
        const change = (evt as { change?: FileChangeEvent }).change;
        if (change) this.tracker.handleFileChanged(change, this.currentWorkspace());
      }
    });

    this.post({ type: 'init', model: this.defaultModel(), sidecar: sidecar.runtimeInfo });
  }

  private defaultModel(): string {
    return vscode.workspace
      .getConfiguration('dshCursorkit.chat')
      .get<string>('defaultModel', 'wps/moonshot/kimi-k2.7-code');
  }

  private async handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'send': {
        const text = String(msg.text ?? '');
        if (!text.trim()) return;
        try {
          const workspace = this.currentWorkspace();
          await this.ckp.ensureSession(workspace, this.defaultModel());
          // 上下文注入（V2-DECISIONS D18）：@file 提及 + 当前选中自动携带
          const ctx = buildInjectedContext(text, workspace);
          if (ctx.selection && ctx.files.length === 0) {
            // 仅有选中文本：附加到消息（Cursor 习惯：选中即上下文）
            void this.post({
              type: 'info',
              message: `已自动附加选中文本（${ctx.selection.length} 字符）`,
            });
          }
          await this.ckp.sendMessage(text, { mentions: ctx.mentions });
        } catch (err) {
          void this.post({ type: 'error', message: (err as Error).message });
        }
        return;
      }
      case 'stop':
        await this.ckp.cancel().catch(() => undefined);
        return;
      case 'newSession':
        // 强制新会话：切换到一个新 session
        await this.ckp.listSessions().catch(() => []);
        void this.post({ type: 'info', message: '新建会话：请使用会话列表或重启扩展（M1 完善）' });
        return;
      case 'review.list': {
        const changes = this.tracker.list();
        void this.post({ type: 'review.list', changes });
        return;
      }
      case 'review.diff': {
        const path = String(msg.path ?? '');
        if (path) await this.tracker.showDiff(path, this.currentWorkspace());
        return;
      }
      case 'review.reject': {
        const path = String(msg.path ?? '');
        if (path) {
          await rejectChange(path, this.currentWorkspace());
          void this.post({ type: 'info', message: `已还原: ${path}` });
        }
        return;
      }
      case 'checkpoint.list': {
        const sessionId = String(msg.sessionId ?? '') || this.ckp.sessionId || '';
        if (sessionId && this.ckp.ready) {
          try {
            const checkpoints = await this.ckp.checkpointList(sessionId);
            void this.post({ type: 'checkpoint.list', sessionId, checkpoints });
          } catch (err) {
            void this.post({ type: 'error', message: `checkpoint 读取失败: ${(err as Error).message}` });
          }
        }
        return;
      }
      case 'checkpoint.restore': {
        const checkpointId = String(msg.checkpointId ?? '');
        if (checkpointId && this.ckp.ready) {
          try {
            await this.ckp.checkpointRestore(checkpointId);
            void this.post({ type: 'info', message: `已恢复 checkpoint ${checkpointId.slice(0, 8)}` });
          } catch (err) {
            void this.post({ type: 'error', message: `恢复失败: ${(err as Error).message}` });
          }
        }
        return;
      }
      default:
        return;
    }
  }

  private currentWorkspace(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const active = vscode.window.activeTextEditor?.document.uri;
      if (active) {
        const f = vscode.workspace.getWorkspaceFolder(active);
        if (f) return f.uri.fsPath;
      }
      return folders[0].uri.fsPath;
    }
    return vscode.env.appRoot; // 无工作区时兜底
  }

  private post(msg: unknown): Thenable<boolean> {
    return this.panel.webview.postMessage(msg);
  }

  private renderHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'chat.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'chat.css'));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${styleUri}">
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /** 请求 webview 打开 checkpoint 时间线（由命令触发）。 */
  public requestCheckpoints(): void {
    void this.post({ type: 'checkpoint.open' });
  }

  public reveal(): void {
    this.panel.reveal();
  }

  public dispose(): void {
    ChatPanel.current = null;
    this.disposables.forEach((d) => d.dispose());
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
