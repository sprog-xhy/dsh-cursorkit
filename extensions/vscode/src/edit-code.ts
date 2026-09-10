/**
 * Ctrl+K 行内编辑（V2-DECISIONS D9）：
 * 选中文本 → Ctrl+K → 输入指令 → agent 生成替换（Edit 模式）→ 内联 diff 接受/拒绝。
 *
 * 实现：QuickInput 收集指令 → CKP 发送（Edit 模式 + 选中内容为上下文）→
 * 等待 message.done → 把 agent 回复作为替换文本 → vscode 内联 diff 预览。
 */
import * as vscode from 'vscode';
import type { CkpService } from './ckp.ts';

export async function runInlineEdit(ckp: CkpService): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('DSH Ctrl+K：请先在编辑器中选中代码');
    return;
  }
  const selection = editor.selection;
  if (selection.isEmpty) {
    // 无选中：默认取整行（Cursor 行为）
    const line = editor.document.lineAt(selection.start.line);
    const range = line.range;
    editor.selection = new vscode.Selection(range.start, range.end);
  }
  const sel = editor.selection;
  const selectedText = editor.document.getText(sel);
  if (!selectedText.trim()) {
    void vscode.window.showInformationMessage('DSH Ctrl+K：选中的代码为空');
    return;
  }

  // 输入指令（Cursor 风格输入框）
  const instruction = await vscode.window.showInputBox({
    prompt: 'DSH Ctrl+K：输入编辑指令（Enter 生成）',
    placeHolder: '例如：改成更简洁的实现 / 加错误处理 / 重命名变量',
    valueSelection: undefined,
  });
  if (instruction === undefined || instruction.trim() === '') return;

  // 准备会话与上下文
  const workspace = currentWorkspaceFor(editor);
  try {
    await ckp.ensureSession(workspace, defaultModel());
    // Edit 模式：指令 + 选中代码
    const prompt = `${instruction}\n\n请只输出修改后的完整代码块，不要解释。当前选中的代码：\n\`\`\`\n${selectedText}\n\`\`\``;
    // 等待 agent 回复（挂一个一次性事件收集 message.done）
    const result = await sendAndCollect(ckp, prompt);
    if (!result) {
      void vscode.window.showInformationMessage('DSH Ctrl+K：agent 未返回结果');
      return;
    }
    await showInlineDiff(editor, sel, selectedText, result);
  } catch (err) {
    void vscode.window.showErrorMessage(`DSH Ctrl+K 失败: ${(err as Error).message}`);
  }
}

/** 发送并收集 agent 完整回复（message.done 的文本）。 */
function sendAndCollect(ckp: CkpService, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const sessionId = ckp.sessionId;
    if (!sessionId) {
      resolve(null);
      return;
    }
    let collected = '';
    const timeout = setTimeout(() => resolve(collected || null), 60000);
    const handler = (evt: unknown): void => {
      const e = evt as { type?: string; text?: string; message?: { content?: unknown } };
      if (e?.type === 'message.delta' && typeof e.text === 'string') {
        collected += e.text;
      } else if (e?.type === 'message.done') {
        clearTimeout(timeout);
        off();
        // message.done 可能含完整 content
        const content = e.message?.content;
        if (Array.isArray(content)) {
          const text = content
            .map((b) => (b && typeof b === 'object' ? (b as { text?: string }).text ?? '' : ''))
            .join('');
          if (text) collected = text;
        }
        resolve(collected || null);
      }
    };
    const off = ckp.onEventOnce(handler);
    void ckp.sendMessage(prompt, { mode: 'edit' }).catch(() => {
      clearTimeout(timeout);
      off();
      resolve(null);
    });
  });
}

/** 显示内联 diff 预览，接受则应用替换。 */
async function showInlineDiff(
  editor: vscode.TextEditor,
  selection: vscode.Selection,
  original: string,
  replacement: string,
): Promise<void> {
  const clean = stripFence(replacement);
  const accept = await vscode.window.showQuickPick(
    [
      { label: '$(check) 接受替换', detail: `${original.length} → ${clean.length} 字符` },
      { label: '$(eye) 预览 diff', detail: '打开 diff 视图' },
      { label: '$(diff) 拒绝', detail: '保留原代码' },
    ],
    { placeHolder: 'DSH Ctrl+K：如何应用修改？' },
  );
  if (!accept) return;
  if (accept.label.includes('拒绝')) return;
  if (accept.label.includes('预览')) {
    // 用临时文档对比
    const doc = await vscode.workspace.openTextDocument({
      content: clean,
      language: editor.document.languageId,
    });
    await vscode.commands.executeCommand(
      'vscode.diff',
      editor.document.uri,
      doc.uri,
      'DSH Ctrl+K 预览',
    );
    // 用户需手动复制；提供"应用"命令后续改进
    return;
  }
  // 接受：替换选中区域
  await editor.edit((edit) => {
    edit.replace(selection, clean);
  });
}

/** 去掉 ``` 代码围栏。 */
function stripFence(s: string): string {
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(s.trim());
  return m ? m[1] : s;
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
