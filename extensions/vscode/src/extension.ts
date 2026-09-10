/**
 * dsh-cursorkit 扩展主入口（V2-DECISIONS D5/D23）。
 *
 * - 激活：命令 / 活动栏视图
 * - 生命周期：activate → SidecarManager + CkpService + ChatController → 宿主（面板/侧边栏）
 * - 退出：dispose → 停止 sidecar
 *
 * 关键修复：
 * - Tab 补全依赖侧边就绪，原先只在 autoStart 路径注册 → 改为「就绪即注册（幂等）」
 * - 侧边栏视图原先渲染空白（只去打开独立面板）→ 交给 SidebarChatViewProvider
 */
import * as vscode from 'vscode';
import { SidecarManager } from './sidecar.ts';
import { CkpService } from './ckp.ts';
import { ChatController } from './chat-controller.ts';
import { ChatPanel, SidebarChatViewProvider } from './panel.ts';
import { VirtualDocProvider, VIRTUAL_SCHEME } from './virtual-docs.ts';
import { runInlineEdit } from './edit-code.ts';
import { TabCompletionProvider } from './tab-completion.ts';

let sidecar: SidecarManager | null = null;
let ckp: CkpService | null = null;
let controller: ChatController | null = null;
let docs: VirtualDocProvider | null = null;
let tabRegistered = false;
let extContext: vscode.ExtensionContext | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extContext = context;
  sidecar = new SidecarManager(context);
  ckp = new CkpService();
  docs = new VirtualDocProvider();
  controller = new ChatController(ckp, sidecar, docs, context);

  context.subscriptions.push(
    docs,
    vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_SCHEME, docs),
  );

  // --- 命令 ---
  context.subscriptions.push(
    vscode.commands.registerCommand('dshCursorkit.newChat', async () => {
      await openChat();
      await controller?.requestNewSession();
    }),
    vscode.commands.registerCommand('dshCursorkit.openChat', () => void openChat()),
    vscode.commands.registerCommand('dshCursorkit.stop', () => void ckp?.cancel()),
    vscode.commands.registerCommand('dshCursorkit.editCode', () => void onInlineEdit()),
    vscode.commands.registerCommand('dshCursorkit.toggleTab', async () => {
      const cfg = vscode.workspace.getConfiguration('dshCursorkit.tab');
      const cur = cfg.get<boolean>('enabled', true);
      await cfg.update('enabled', !cur, vscode.ConfigurationTarget.Global);
      void vscode.window.setStatusBarMessage(`DSH Tab 补全已${!cur ? '开启' : '关闭'}`, 3000);
    }),
    vscode.commands.registerCommand('dshCursorkit.openSettings', () =>
      void vscode.commands.executeCommand('workbench.action.openSettings', 'dshCursorkit'),
    ),
    vscode.commands.registerCommand('dshCursorkit.checkpoints', () => void openCheckpoints()),
    vscode.commands.registerCommand('dshCursorkit.focusChatView', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.dshCursorkit');
      await vscode.commands.executeCommand('dshCursorkit.chatView.focus');
    }),
  );

  // --- 侧边栏：活动栏视图（真正渲染 webview）+ 会话树 ---
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarChatViewProvider.viewType,
      new SidebarChatViewProvider(controller),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
  const tree = sessionsTree();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('dshCursorkit.sessions', tree));
  context.subscriptions.push(controller.onDidChangeSessions.event(() => tree.refresh()));

  // --- 自动启动 sidecar ---
  const autoStart = vscode.workspace.getConfiguration('dshCursorkit.sidecar').get<boolean>('autoStart', true);
  if (autoStart) {
    void ensureReady().catch((err: Error) => {
      void vscode.window.showErrorMessage(`DSH sidecar 启动失败：${err.message}`);
    });
  }
}

export function deactivate(): void {
  controller?.dispose();
  sidecar?.dispose();
  sidecar = null;
  ckp = null;
  controller = null;
  docs = null;
  extContext = null;
}

/** 确保 sidecar 就绪 + transport 注入 + Tab 补全注册（幂等）。 */
async function ensureReady(): Promise<void> {
  if (!sidecar || !ckp) return;
  if (!sidecar.runtimeInfo) await sidecar.start();
  if (!ckp.ready) ckp.attach(sidecar.createTransport());
  if (!tabRegistered && extContext) {
    const provider = new TabCompletionProvider(ckp);
    extContext.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider),
    );
    tabRegistered = true;
  }
}

/** 打开（或聚焦）编辑器面板。 */
async function openChat(): Promise<void> {
  if (ChatPanel.current) {
    ChatPanel.current.reveal();
    return;
  }
  if (!controller || !sidecar) return;
  try {
    await ensureReady();
  } catch (err) {
    void vscode.window.showErrorMessage(`DSH sidecar 启动失败：${(err as Error).message}`);
    return;
  }
  new ChatPanel(controller.extensionContext, controller);
}

async function openCheckpoints(): Promise<void> {
  await openChat();
  controller?.broadcast({ type: 'checkpoint.open' });
}

/** Ctrl+K：sidecar 就绪后执行行内编辑。 */
async function onInlineEdit(): Promise<void> {
  if (!ckp || !docs) return;
  try {
    await ensureReady();
  } catch (err) {
    void vscode.window.showErrorMessage(`DSH sidecar 未就绪：${(err as Error).message}`);
    return;
  }
  await runInlineEdit({ ckp, docs });
}

/** 会话树（侧边栏）。 */
function sessionsTree(): vscode.TreeDataProvider<vscode.TreeItem> & { refresh(): void } {
  const emitter = new vscode.EventEmitter<void>();
  const provider: vscode.TreeDataProvider<vscode.TreeItem> & { refresh(): void } = {
    onDidChangeTreeData: emitter.event,
    refresh: () => emitter.fire(),
    getTreeItem: (el) => el,
    getChildren: async () => {
      if (!ckp?.ready) return [new vscode.TreeItem('sidecar 未就绪')];
      try {
        const sessions = await ckp.listSessions();
        const active = ckp.sessionId;
        return sessions.map((s) => {
          const item = new vscode.TreeItem(
            s.id.slice(0, 10) + (s.id === active ? '  ●' : ''),
            vscode.TreeItemCollapsibleState.None,
          );
          item.description = s.workspace.split('/').pop();
          item.tooltip = `${s.id}\n${s.workspace}`;
          item.iconPath = new vscode.ThemeIcon(s.id === active ? 'circle-filled' : 'comment-discussion');
          item.command = { command: 'dshCursorkit.openChat', title: 'Open Chat', arguments: [] };
          return item;
        });
      } catch {
        return [new vscode.TreeItem('无法读取会话')];
      }
    },
  };
  return provider;
}
