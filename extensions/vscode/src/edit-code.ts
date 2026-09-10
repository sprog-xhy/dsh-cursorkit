/**
 * Ctrl+K 行内编辑（V2-DECISIONS D9）：
 * 选中文本 → Ctrl+K → 输入指令 → agent 生成替换（Edit 模式）→ diff 预览/接受/拒绝。
 *
 * 关键修复：
 * - 原实现只处理 message.done，遇到 error/cancelled 会挂到 60s 超时
 *   → 改用 CkpService.sendAndWaitText（统一处理 done/error/cancelled）
 * - "预览 diff" 原先是「整文件 vs 代码片段」，语义混乱
 *   → 用虚拟文档做「整文件改前 ↔ 整文件改后」的真实 diff
 * - 应用替换前校验编辑器缓冲区未被并发修改（避免写到错误位置）
 */
import * as vscode from 'vscode';
import type { CkpService } from './ckp.ts';
import { showSnapshotDiff, type VirtualDocProvider } from './virtual-docs.ts';
import { stripFence } from './text-utils.ts';

export interface InlineEditDeps {
  ckp: CkpService;
  docs: VirtualDocProvider;
}

export async function runInlineEdit({ ckp, docs }: InlineEditDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('DSH Ctrl+K：请先在编辑器中选中代码');
    return;
  }
  // 无选中：默认取整行（Cursor 行为）
  if (editor.selection.isEmpty) {
    const line = editor.document.lineAt(editor.selection.start.line);
    editor.selection = new vscode.Selection(line.range.start, line.range.end);
  }
  const sel = editor.selection;
  const selectedText = editor.document.getText(sel);
  if (!selectedText.trim()) {
    void vscode.window.showInformationMessage('DSH Ctrl+K：选中的代码为空');
    return;
  }

  const instruction = await vscode.window.showInputBox({
    prompt: 'DSH Ctrl+K：输入编辑指令（Enter 生成）',
    placeHolder: '例如：改成更简洁的实现 / 加错误处理 / 重命名变量',
  });
  if (instruction === undefined || instruction.trim() === '') return;

  const workspace = currentWorkspaceFor(editor);
  const docVersion = editor.document.version;
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'DSH 正在生成修改…' },
      async () => {
        const session = await ckp.ensureSession(workspace, defaultModel());
        const prompt =
          `${instruction}\n\n` +
          `请只输出修改后的完整代码块（保持原有缩进与风格），不要解释。\n` +
          `当前选中的代码：\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
        const result = await ckp.sendAndWaitText(session.id, prompt, 'edit');
        if (!result) {
          void vscode.window.showInformationMessage('DSH Ctrl+K：agent 未返回结果');
          return;
        }
        await applyOrPreview(editor, sel, selectedText, result, docs, docVersion);
      },
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`DSH Ctrl+K 失败: ${(err as Error).message}`);
  }
}

/** 接受 / 预览 / 拒绝。 */
async function applyOrPreview(
  editor: vscode.TextEditor,
  selection: vscode.Selection,
  original: string,
  replacement: string,
  docs: VirtualDocProvider,
  expectedVersion: number,
): Promise<void> {
  const clean = stripFence(replacement);
  if (!clean.trim()) {
    void vscode.window.showInformationMessage('DSH Ctrl+K：生成结果为空');
    return;
  }
  const accept = await vscode.window.showQuickPick(
    [
      { label: '$(check) 接受替换', detail: `${original.length} → ${clean.length} 字符` },
      { label: '$(diff) 预览 diff', detail: '整文件改前 ↔ 改后' },
      { label: '$(close) 拒绝', detail: '保留原代码' },
    ],
    { placeHolder: 'DSH Ctrl+K：如何应用修改？' },
  );
  if (!accept || accept.label.includes('拒绝')) return;

  if (accept.label.includes('预览')) {
    const doc = editor.document;
    const full = doc.getText();
    const offsetStart = doc.offsetAt(selection.start);
    const offsetEnd = doc.offsetAt(selection.end);
    const after = full.slice(0, offsetStart) + clean + full.slice(offsetEnd);
    await showSnapshotDiff(docs, doc.uri.fsPath, full, after, `${doc.uri.path.split('/').pop()}（Ctrl+K 预览）`);
    return;
  }

  // 接受：确认缓冲区未被其他操作改动，避免替换到错误位置
  const doc = editor.document;
  if (doc.version !== expectedVersion) {
    const go = await vscode.window.showWarningMessage(
      '文件在生成期间已被修改，仍要替换原选中位置吗？',
      { modal: true },
      '仍然替换',
    );
    if (go !== '仍然替换') return;
  }
  const ok = await editor.edit((edit) => edit.replace(selection, clean));
  if (!ok) void vscode.window.showErrorMessage('DSH Ctrl+K：替换失败（编辑器繁忙），请重试');
}

function currentWorkspaceFor(editor: vscode.TextEditor): string {
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (folder) return folder.uri.fsPath;
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : vscode.env.appRoot;
}

function defaultModel(): string {
  return vscode.workspace
    .getConfiguration('dshCursorkit.chat')
    .get<string>('defaultModel', 'wps/moonshot/kimi-k2.7-code');
}
