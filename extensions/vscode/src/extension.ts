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
import { activityLog } from './activity-log.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePackageDirs } from './sidecar.ts';

let sidecar: SidecarManager | null = null;
let ckp: CkpService | null = null;
let controller: ChatController | null = null;
let docs: VirtualDocProvider | null = null;
let tabRegistered = false;
let extContext: vscode.ExtensionContext | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extContext = context;
  activityLog(`activate | vscode=${vscode.version} extension=${String(context.extension.packageJSON.version ?? '?')}`);
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
    vscode.commands.registerCommand('dshCursorkit.doctor', () => void runDoctor(context)),
    vscode.commands.registerCommand('dshCursorkit.focusChatView', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.dshCursorkit');
      await vscode.commands.executeCommand('dshCursorkit.chatView.focus');
    }),
  );

  // --- URI 入口：vscode://sprogx.dsh-cursorkit/chat|sidebar|new|doctor ---
  // 便于从命令行/外部工具直接打开（也用于自动化与排障）。
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        const action = uri.path.replace(/^\/+/, '') || 'chat';
        activityLog(`uri | ${action}`);
        switch (action) {
          case 'sidebar':
            void vscode.commands.executeCommand('workbench.view.extension.dshCursorkit');
            void vscode.commands.executeCommand('dshCursorkit.chatView.focus');
            break;
          case 'new':
            void openChat().then(() => controller?.requestNewSession());
            break;
          case 'doctor':
            void vscode.commands.executeCommand('dshCursorkit.doctor');
            break;
          default:
            void openChat();
            break;
        }
      },
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

  // --- 首次激活引导（只弹一次，避免打扰） ---
  const WELCOME_KEY = 'dshCursorkit.welcomed';
  try {
    if (!context.globalState.get<boolean>(WELCOME_KEY)) {
    void context.globalState.update(WELCOME_KEY, true);
    void vscode.window
      .showInformationMessage(
        'DSH CursorKit 已就绪（以 dsh 为内核的 AI 编程助手）',
        '在侧边栏打开',
        '打开独立面板',
        '自检',
      )
      .then((pick) => {
        if (pick === '在侧边栏打开') {
          void vscode.commands.executeCommand('workbench.view.extension.dshCursorkit');
          void vscode.commands.executeCommand('dshCursorkit.chatView.focus');
        } else if (pick === '打开独立面板') {
          void vscode.commands.executeCommand('dshCursorkit.openChat');
        } else if (pick === '自检') {
          void vscode.commands.executeCommand('dshCursorkit.doctor');
        }
      });
    }
  } catch (err) {
    // 首次引导失败绝不能影响激活
    console.error('[dsh-cursorkit] welcome notice failed', err);
  }

  // --- 自动启动 sidecar ---
  const autoStart = vscode.workspace.getConfiguration('dshCursorkit.sidecar').get<boolean>('autoStart', true);
  if (autoStart) {
    void ensureReady().catch((err: Error) => {
      void vscode.window.showErrorMessage(`DSH sidecar 启动失败：${err.message}`);
    });
  }
}

/**
 * 自检 / 诊断：把关键环境信息写进输出面板并给出结论。
 * 用户 "看不到效果" 时第一时间跑这个。
 */
async function runDoctor(context: vscode.ExtensionContext): Promise<void> {
  try {
    await runDoctorInner(context);
  } catch (err) {
    void vscode.window.showErrorMessage(`DSH 自检失败：${(err as Error).message}`);
  }
}

async function runDoctorInner(context: vscode.ExtensionContext): Promise<void> {
  const out = vscode.window.createOutputChannel('DSH Cursor Kit 自检');
  out.show(true);
  const line = (s: string): void => out.appendLine(s);
  const yn = (b: boolean): string => (b ? '✅' : '❌');

  line('=== DSH CursorKit 自检 ===');
  line(`扩展版本：${String(context.extension.packageJSON.version ?? '?')}`);
  line(`VSCode：${vscode.version}`);
  line(`扩展路径：${context.extensionUri.fsPath}`);

  // 包目录（开发仓库 / 内置副本）
  let dirs: { hostDir: string; protocolDir: string } | null = null;
  try {
    dirs = resolvePackageDirs(
      vscode.workspace.getConfiguration('dshCursorkit.sidecar').get<string>('hostDshPath', ''),
    );
    line(`host-dsh 包目录：${dirs.hostDir}`);
    line(`protocol 包目录：${dirs.protocolDir}`);
  } catch (err) {
    line(`${yn(false)} 找不到 host-dsh / protocol：${(err as Error).message}`);
  }

  // dsh 可执行文件与版本
  const dshBin = sidecar?.findDsh() ?? null;
  line(`${yn(!!dshBin)} dsh 可执行文件：${dshBin ?? '未找到（需要 npm i -g @deepseek-ai/dsh@0.1.1-rc.2）'}`);
  const home = sidecar?.dshHome ?? '(未知)';
  line(`DSH_HOME：${home}`);
  line(`${yn(existsSync(join(home, 'settings.yaml')))} settings.yaml（provider 配置）`);
  line(`${yn(existsSync(join(home, '.credentials.yaml')))} .credentials.yaml（凭据）`);
  const profileDirPath = join(home, 'profiles', 'cursorkit');
  line(`${yn(existsSync(join(profileDirPath, 'cordis.patch.yml')))} profile：${profileDirPath}`);
  line(
    `${yn(existsSync(join(profileDirPath, 'node_modules', '@dsh-cursorkit', 'host-dsh', 'package.json')))} profile 依赖（host-dsh 已安装）`,
  );

  // sidecar 状态与连通性
  const status = sidecar?.currentStatus ?? 'stopped';
  const info = sidecar?.runtimeInfo ?? null;
  line(`${info ? '✅' : '❌'} sidecar 状态：${status}${info ? `（pid=${info.pid} port=${info.port} dsh=${info.dshVersion}）` : ''}`);
  if (ckp?.ready && info) {
    try {
      const models = await ckp.listModels();
      line(`${models.length > 0 ? '✅' : '⚠️'} 可用模型：${models.length} 个（provider 读取自 settings.yaml）`);
    } catch (err) {
      line(`❌ CKP 调用失败：${(err as Error).message}`);
    }
  } else {
    line('❌ CKP 未连接（可执行命令「DSH CursorKit: 启动 dsh sidecar」或重启窗口）');
  }

  // 已注册的命令与视图（确认 UI 入口存在）
  const cmds = await vscode.commands.getCommands(true);
  const ours = cmds.filter((c) => c.startsWith('dshCursorkit.'));
  line(`已注册命令（${ours.length}）：${ours.join(', ')}`);
  line(
    `UI 入口：活动栏「DSH CursorKit」→ Chat / Sessions 视图；或命令面板输入 "DSH"；或快捷键 Ctrl+Alt+C`,
  );

  const ok = !!dshBin && !!info;
  line(ok ? '=== 结论：环境就绪，可直接使用 ===' : '=== 结论：环境未就绪，见上面 ❌ 项 ===');
  void vscode.window.showInformationMessage(
    ok ? 'DSH CursorKit 自检通过：环境就绪' : 'DSH CursorKit 自检发现问题，详见「DSH CursorKit 自检」输出',
  );
}

export function deactivate(): void {
  activityLog('deactivate');
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
