/**
 * Tab 补全（V2-DECISIONS D8）：
 * InlineCompletionProvider —— 击键停止后请求 agent 续写，Tab 接受 ghost text。
 *
 * 关键修复：
 * - 原先不检查 CancellationToken → 用户已继续输入仍会打模型（白花钱）
 * - 原先光标移动/滚动也会触发（VSCode 在光标变化时也会调用 provider）
 *   → 用「文档版本」判定是否真的发生了输入
 * - 复用 edit-code 的 stripFence（原先两处重复实现）
 */
import * as vscode from 'vscode';
import type { CkpService } from './ckp.ts';
import { stripFence } from './text-utils.ts';

const MAX_PREFIX_LINES = 40;
const MAX_PREFIX_CHARS = 4000;

export class TabCompletionProvider implements vscode.InlineCompletionItemProvider {
  private pendingRequest = 0;
  /** 最近一次已请求的「文档版本」，用于区分输入与纯光标移动。 */
  private lastRequestKey: string | null = null;

  constructor(private readonly ckp: CkpService) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[] | undefined> {
    if (!vscode.workspace.getConfiguration('dshCursorkit.tab').get<boolean>('enabled', true)) {
      return undefined;
    }
    if (!this.ckp.ready) return undefined;
    // 只在用户真实输入后触发（光标移动/滚动不调用模型）
    const key = `${document.uri.toString()}:${document.version}`;
    if (this.lastRequestKey === key) return undefined;

    const debounce = vscode.workspace
      .getConfiguration('dshCursorkit.tab')
      .get<number>('debounceMs', 200);
    await sleep(debounce);
    if (token.isCancellationRequested) return undefined;

    const prefix = this.prefixOf(document, position);
    if (!prefix.trim()) return undefined;

    const requestId = ++this.pendingRequest;
    this.lastRequestKey = key;
    const completion = await this.requestCompletion(
      prefix,
      this.suffixLineOf(document, position),
      document.languageId,
    );
    // 期间用户继续输入 → 丢弃本次结果
    if (token.isCancellationRequested || requestId !== this.pendingRequest || !completion) {
      return undefined;
    }
    const item = new vscode.InlineCompletionItem(completion, new vscode.Range(position, position));
    return [item];
  }

  /** 光标前的上下文（最多 40 行 / 4000 字符）。 */
  private prefixOf(document: vscode.TextDocument, position: vscode.Position): string {
    const startLine = Math.max(0, position.line - MAX_PREFIX_LINES);
    const start = new vscode.Position(startLine, 0);
    return document.getText(new vscode.Range(start, position)).slice(-MAX_PREFIX_CHARS);
  }

  /** 光标后第一行（帮助模型避免重复）。 */
  private suffixLineOf(document: vscode.TextDocument, position: vscode.Position): string {
    const line = Math.min(position.line + 1, document.lineCount - 1);
    return document.lineAt(line).text;
  }

  private async requestCompletion(
    prefix: string,
    suffixLine: string,
    languageId: string,
  ): Promise<string | null> {
    try {
      const workspace = activeWorkspace();
      const session = await this.ckp.ensureCompletionSession(workspace);
      const prompt =
        `继续补全以下代码（只输出续写内容，不要解释，不要重复已给代码，保持缩进风格）：\n` +
        `语言: ${languageId}\n` +
        `\`\`\`\n${prefix}\n\`\`\`` +
        (suffixLine.trim()
          ? `\n\n（光标后的第一行内容：\`${suffixLine.trim()}\`，续写不要与它重复）`
          : '');
      const result = await this.ckp.sendAndWaitText(session.id, prompt);
      if (!result) return null;
      const clean = stripFence(result).trim();
      return clean || null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
