/**
 * IDE 适配层（V2-DECISIONS D5/D18/D27）：
 * 把 VSCode 的编辑器状态翻译为 agent 上下文。
 *
 * 关键修复：选中文本原先只弹了一句"已自动附加选中文本"提示，
 * 但内容从未拼进消息（agent 实际看不到）——现在由 formatSelectionBlock 真正注入。
 */
import * as vscode from 'vscode';
import { relative } from 'node:path';

/** 编辑器选中信息。 */
export interface SelectionInfo {
  text: string;
  /** workspace 相对路径（跨 root 时退回绝对路径）。 */
  file: string;
  /** 1-based 起始行。 */
  startLine: number;
  /** 1-based 结束行。 */
  endLine: number;
  languageId: string;
}

export interface InjectedContext {
  /** @file/@folder 提及解析出的路径。 */
  files: string[];
  /** 当前选中（自动上下文）。 */
  selection?: SelectionInfo;
  /** 传给 sidecar 的 mentions（`file:<path>` 形式）。 */
  mentions: string[];
}

/** 当前 workspace root（multi-root：active editor 所在 root，D27）。 */
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

/** 解析用户输入中的 @file / @folder 提及 → 路径列表。 */
export function parseMentions(text: string): string[] {
  const files: string[] = [];
  const re = /@(?:file|folder):([^\s\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const p = m[1].replace(/[",)]+$/, '');
    if (p) files.push(p);
  }
  return files;
}

/** 当前选中（含文件与行号）。 */
export function currentSelection(workspace: string): SelectionInfo | undefined {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return undefined;
  const sel = ed.selection;
  if (sel.isEmpty) return undefined;
  const text = ed.document.getText(sel);
  if (!text.trim()) return undefined;
  const abs = ed.document.uri.fsPath;
  const rel = workspace ? relative(workspace, abs) : abs;
  return {
    text,
    file: rel && !rel.startsWith('..') ? rel : abs,
    startLine: sel.start.line + 1,
    endLine: sel.end.line + 1,
    languageId: ed.document.languageId,
  };
}

/** 构造注入上下文（@file 提及 + 当前选中）。 */
export function buildInjectedContext(userText: string, workspace: string): InjectedContext {
  const files = parseMentions(userText);
  const selection = currentSelection(workspace);
  return { files, selection, mentions: files.map((f) => `file:${f}`) };
}

/** 把选中内容格式化为可拼进消息的代码块（真正注入 agent）。 */
export function formatSelectionBlock(sel: SelectionInfo): string {
  const lines = sel.startLine === sel.endLine ? `第 ${sel.startLine} 行` : `第 ${sel.startLine}-${sel.endLine} 行`;
  return (
    `\n\n以下是用户当前在编辑器里选中的代码（${sel.file} ${lines}），` +
    `与本次请求直接相关：\n\`\`\`${sel.languageId}\n${sel.text}\n\`\`\``
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
