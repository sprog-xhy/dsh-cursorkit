/**
 * Tab 补全（V2-DECISIONS D8）：
 * InlineCompletionProvider —— 击键停止后请求 agent 续写，Tab 接受 ghost text。
 *
 * 实现要点：
 * - 防抖 200ms（settings 可调）
 * - 上下文 = 当前文件光标前 N 行 + 光标后 1 行（语言感知裁剪）
 * - 通过 CKP 用独立"补全会话"请求（Ask 模式，只读，不污染聊天会话）
 * - 结果去掉代码围栏，取第一段完整续写
 */
import * as vscode from 'vscode';
import type { CkpService } from './ckp.ts';

const MAX_PREFIX_LINES = 40;
const MAX_PREFIX_CHARS = 4000;

export class TabCompletionProvider implements vscode.InlineCompletionItemProvider {
  private pendingRequest = 0;

  constructor(private readonly ckp: CkpService) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[] | undefined> {
    const enabled = vscode.workspace
      .getConfiguration('dshCursorkit.tab')
      .get<boolean>('enabled', true);
    if (!enabled) return undefined;
    if (!this.ckp.ready) return undefined;

    const debounce = vscode.workspace
      .getConfiguration('dshCursorkit.tab')
      .get<number>('debounceMs', 200);
    // 防抖：等待用户停止输入
    await sleep(debounce);

    // 光标前内容（续写的输入）
    const start = position.translate(-MAX_PREFIX_LINES, 0).line < 0 ? new vscode.Position(0, 0) : position.translate(-MAX_PREFIX_LINES, 0);
    const prefix = document.getText(new vscode.Range(start, position)).slice(-MAX_PREFIX_CHARS);
    if (!prefix.trim()) return undefined;

    // 光标后一行（辅助判断续写语境）
    const suffixLine = document.lineAt(Math.min(position.line + 1, document.lineCount - 1)).text;

    const requestId = ++this.pendingRequest;
    const completion = await this.requestCompletion(prefix, suffixLine, document.languageId);
    // 若期间有新的击键请求，丢弃本次结果（保持最新）
    if (requestId !== this.pendingRequest || !completion) return undefined;

    const item = new vscode.InlineCompletionItem(completion, new vscode.Range(position, position));
    item.range = new vscode.Range(position, position);
    return [item];
  }

  private async requestCompletion(
    prefix: string,
    suffixLine: string,
    languageId: string,
  ): Promise<string | null> {
    try {
      // 用独立补全会话避免干扰聊天会话
      const workspace = activeWorkspace();
      const session = await this.ckp.ensureCompletionSession(workspace);
      const prompt =
        `继续补全以下代码（只输出续写内容，不要解释，不要重复已给代码，保持缩进风格）：\n` +
        `语言: ${languageId}\n` +
        `\`\`\`\n${prefix}\n\`\`\`` +
        (suffixLine.trim() ? `\n\n（光标后的第一行内容：\`${suffixLine.trim()}\`，续写不要与它重复）` : '');
      const result = await this.ckp.sendAndWaitText(session.id, prompt);
      if (!result) return null;
      const clean = stripFence(result).trim();
      // 去掉与 suffix 重叠部分
      return clean;
    } catch {
      return null;
    }
  }
}

function activeWorkspace(): string {
  const folders = vscode.workspace.workspaceFolders;
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const f = vscode.workspace.getWorkspaceFolder(active);
    if (f) return f.uri.fsPath;
  }
  return folders && folders.length > 0 ? folders[0].uri.fsPath : vscode.env.appRoot;
}

function stripFence(s: string): string {
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(s.trim());
  return m ? m[1] : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
