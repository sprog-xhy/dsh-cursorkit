/**
 * IDE 适配层（V2-DECISIONS D5/D18/D27）：
 * 把 VSCode 的编辑器状态翻译为 agent 上下文：
 * - 当前选中文本 / 打开编辑器（自动注入）
 * - @file / @folder 提及解析为路径
 * - 当前 workspace（multi-root：active editor 所在 root）
 */
import * as vscode from 'vscode';

export interface InjectedContext {
  /** 注入的文件（绝对路径或 workspace 相对路径）。 */
  files: string[];
  /** 当前选中文本。 */
  selection?: string;
  /** 用户输入的 @提及（原始形式）。 */
  mentions: string[];
}

/** 当前 workspace root（V2-DECISIONS D27）。 */
export function currentWorkspace(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return '';
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const f = vscode.workspace.getWorkspaceFolder(active);
    if (f) return f.uri.fsPath;
  }
  return folders[0].uri.fsPath;
}

/** 解析用户输入中的 @file / @folder 提及 → 文件路径列表。 */
export function parseMentions(text: string, workspace: string): string[] {
  const files: string[] = [];
  const re = /@(?:file|folder):([^\s\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const p = m[1].replace(/[",)]+$/, '');
    files.push(p);
  }
  return files;
}

/** 当前选中文本（若有编辑器选中）。 */
export function currentSelection(): string | undefined {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return undefined;
  const sel = ed.selection;
  if (sel.isEmpty) return undefined;
  return ed.document.getText(sel);
}

/** 构造注入上下文（自动注入当前选中 + @file 提及）。 */
export function buildInjectedContext(userText: string, workspace: string): InjectedContext {
  const files = parseMentions(userText, workspace);
  const selection = currentSelection();
  return { files, selection, mentions: files.map((f) => `file:${f}`) };
}

/** 打开 diff 视图（agent 改动的文件 vs 原始）。 */
export async function showDiff(originalPath: string, modifiedPath: string, title: string): Promise<void> {
  const original = vscode.Uri.file(originalPath);
  const modified = vscode.Uri.file(modifiedPath);
  await vscode.commands.executeCommand(
    'vscode.diff',
    original,
    modified,
    `DSH: ${title}`,
  );
}

/** 打开文件并跳转位置。 */
export async function openFile(path: string, line?: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
  const editor = await vscode.window.showTextDocument(doc);
  if (typeof line === 'number' && line >= 0) {
    const pos = new vscode.Position(line, 0);
    editor.revealRange(new vscode.Range(pos, pos));
    editor.selection = new vscode.Selection(pos, pos);
  }
}
