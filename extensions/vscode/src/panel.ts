/**
 * Chat 宿主：编辑器面板（ChatPanel）+ 活动栏侧边栏视图（SidebarChatViewProvider）。
 *
 * 修复：侧边栏视图原先 resolveWebviewView 只是去调用 openChat（打开另一个编辑器面板），
 * 视图本身永远空白。现在两者都渲染同一套 webview，并挂到同一个 ChatController。
 */
import * as vscode from 'vscode';
import type { ChatController, ChatHost } from './chat-controller.ts';
import { renderWebviewHtml } from './webview-html.ts';

/** 编辑器面板宿主（Ctrl+Alt+C / 命令打开）。 */
export class ChatPanel implements ChatHost {
  public static current: ChatPanel | null = null;

  readonly kind = 'panel' as const;
  readonly hostId = `panel-${Date.now()}`;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    public readonly context: vscode.ExtensionContext,
    private readonly controller: ChatController,
  ) {
    this.panel = vscode.window.createWebviewPanel('dshCursorkit.chat', 'DSH CursorKit', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    });
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.png');
    this.panel.webview.html = renderWebviewHtml(context, this.panel.webview);
    this.panel.webview.onDidReceiveMessage(
      (msg) => void this.controller.handleMessage(msg, this),
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.controller.attach(this);
    ChatPanel.current = this;
  }

  get webview(): vscode.Webview {
    return this.panel.webview;
  }

  post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }

  reveal(): void {
    this.panel.reveal(undefined, true);
  }

  dispose(): void {
    if (ChatPanel.current === this) ChatPanel.current = null;
    this.controller.detach(this);
    this.disposables.forEach((d) => d.dispose());
  }
}

/** 活动栏侧边栏视图宿主。 */
export class SidebarChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dshCursorkit.chatView';

  constructor(private readonly controller: ChatController) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.controller.extensionUri, 'dist', 'webview')],
    };
    const host = new SidebarHost(view, this.controller);
    view.onDidDispose(() => host.dispose());
  }
}

class SidebarHost implements ChatHost {
  readonly kind = 'view' as const;
  readonly hostId = `view-${Date.now()}`;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly view: vscode.WebviewView,
    private readonly controller: ChatController,
  ) {
    this.view.webview.html = renderWebviewHtml(this.controller.extensionContext, this.view.webview);
    this.disposables.push(
      this.view.webview.onDidReceiveMessage((msg) => void this.controller.handleMessage(msg, this)),
    );
    this.controller.attach(this);
  }

  get context(): vscode.ExtensionContext {
    return this.controller.extensionContext;
  }

  get webview(): vscode.Webview {
    return this.view.webview;
  }

  post(msg: unknown): void {
    void this.view.webview.postMessage(msg);
  }

  dispose(): void {
    this.controller.detach(this);
    this.disposables.forEach((d) => d.dispose());
  }
}
