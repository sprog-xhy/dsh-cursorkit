/**
 * dsh-cursorkit 扩展主入口（V2-DECISIONS D5/D23 M0）。
 *
 * - 激活：`dshCursorkit.openChat` 命令 / 活动栏视图
 * - 生命周期：activate → SidecarManager + CkpService → ChatPanel
 * - 退出：dispose → 停止 sidecar
 */
import * as vscode from 'vscode';
import { SidecarManager } from './sidecar.ts';
import { CkpService } from './ckp.ts';
import { ChatPanel } from './panel.ts';
import { runInlineEdit } from './edit-code.ts';

let sidecar: SidecarManager | null = null;
let ckp: CkpService | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  sidecar = new SidecarManager(context);
  ckp = new CkpService();

  // --- 命令注册 ---
  const newChat = vscode.commands.registerCommand('dshCursorkit.newChat', () => {
    void openChat(context);
  });
  const openChatCmd = vscode.commands.registerCommand('dshCursorkit.openChat', () => {
    void openChat(context);
  });
  const stopCmd = vscode.commands.registerCommand('dshCursorkit.stop', () => {
    void ckp?.cancel();
  });
  const editCmd = vscode.commands.registerCommand('dshCursorkit.editCode', () => {
    if (!ckp?.ready) {
      void vscode.window.showErrorMessage('DSH sidecar 未就绪，请稍后再试');
      return;
    }
    void runInlineEdit(ckp);
  });
  const tabCmd = vscode.commands.registerCommand('dshCursorkit.toggleTab', () => {
    void vscode.window.showInformationMessage('Tab 补全将在 M3 提供（V2-DECISIONS D8）');
  });
  const settingsCmd = vscode.commands.registerCommand('dshCursorkit.openSettings', () => {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'dshCursorkit');
  });
  const checkpointsCmd = vscode.commands.registerCommand('dshCursorkit.checkpoints', () => {
    void openChat(context).then(() => {
      void ChatPanel.current?.requestCheckpoints();
    });
  });

  context.subscriptions.push(
    newChat,
    openChatCmd,
    stopCmd,
    editCmd,
    tabCmd,
    settingsCmd,
    checkpointsCmd,
  );

  // --- 自动启动 sidecar（settings 可关） ---
  const autoStart = vscode.workspace
    .getConfiguration('dshCursorkit.sidecar')
    .get<boolean>('autoStart', true);
  if (autoStart) {
    sidecar.start().then(
      () => {
        if (sidecar?.runtimeInfo) ckp?.attach(sidecar.createTransport());
      },
      (err: Error) => {
        void vscode.window.showErrorMessage(`DSH sidecar 启动失败：${err.message}`);
      },
    );
  }

  // 侧边栏会话视图（M0 占位，M1 完善）
  const sessionsProvider: vscode.TreeDataProvider<vscode.TreeItem> = {
    getTreeItem: (el) => el,
    getChildren: async () => {
      if (!ckp?.ready) return [{ label: 'sidecar 未就绪' } as vscode.TreeItem];
      try {
        const sessions = await ckp.listSessions();
        return sessions.map(
          (s) =>
            ({
              label: s.id.slice(0, 8),
              description: s.workspace,
              contextValue: 'session',
              command: { command: 'dshCursorkit.openChat', title: 'Open Chat' },
            }) as vscode.TreeItem,
        );
      } catch {
        return [{ label: '无法读取会话' } as vscode.TreeItem];
      }
    },
  };
  context.subscriptions.push(vscode.window.registerTreeDataProvider('dshCursorkit.sessions', sessionsProvider));

  // 侧边栏 webview 视图（活动栏 Chat）
  const chatViewProvider = {
    resolveWebviewView(webviewView: vscode.WebviewView) {
      // M0 用独立面板；侧边栏视图复用同一面板逻辑（后续合并）
      void openChat(context);
    },
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('dshCursorkit.chat', chatViewProvider),
  );
}

async function openChat(context: vscode.ExtensionContext): Promise<void> {
  if (ChatPanel.current) {
    ChatPanel.current.reveal();
    return;
  }
  if (!ckp || !sidecar) return;
  // 确保 sidecar 就绪
  if (!sidecar.runtimeInfo) {
    try {
      await sidecar.start();
      ckp.attach(sidecar.createTransport());
    } catch (err) {
      void vscode.window.showErrorMessage(`DSH sidecar 启动失败：${(err as Error).message}`);
      return;
    }
  } else if (!ckp.ready) {
    ckp.attach(sidecar.createTransport());
  }
  ChatPanel.current = new ChatPanel(context, ckp, sidecar);
}

export function deactivate(): void {
  sidecar?.dispose();
  sidecar = null;
  ckp = null;
}
