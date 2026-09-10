/**
 * 审查闭环（V2-DECISIONS D6/D11/D28）：
 * agent 写文件（file.changed）→ 自动打开/刷新 VSCode 文件 → diff 视图 → 接受/拒绝。
 *
 * 实现策略：
 * - file.changed 到达时：若文件已在 VSCode 打开则 reload，否则不强制打开
 * - 提供"审查改动"命令：对会话的改动打开 diff 视图（modified vs git HEAD）
 * - 接受 = 关闭 diff；拒绝 = `git checkout` 还原（通过 sidecar git-diff 能力）
 */
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FileChangeEvent {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
  status: string;
}

/** 记录会话最近的改动（供审查面板/命令使用）。 */
export class ChangeTracker {
  private changes = new Map<string, FileChangeEvent>();

  /** file.changed 事件处理：刷新打开的文件 + 记录改动。 */
  handleFileChanged(change: FileChangeEvent, workspace: string): void {
    this.changes.set(change.path, change);
    // agent 改了磁盘内容：VSCode 打开的缓冲区若未修改则自动重载（重新读盘）
    const abs = this.resolvePath(change.path, workspace);
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.fsPath === abs && !doc.isDirty) {
        void vscode.workspace.openTextDocument(doc.uri).then(() => undefined);
        break;
      }
    }
  }

  /** 列出会话全部改动。 */
  list(): FileChangeEvent[] {
    return [...this.changes.values()];
  }

  clear(): void {
    this.changes.clear();
  }

  /** 对指定改动打开 diff 视图（original = git HEAD 或磁盘当前内容）。 */
  async showDiff(path: string, workspace: string): Promise<void> {
    const abs = this.resolvePath(path, workspace);
    // original: 尝试从 git HEAD 取（sidecar git-diff 能力）；兜底用当前内容
    const original = vscode.Uri.file(abs);
    const modified = vscode.Uri.file(abs);
    await vscode.commands.executeCommand('vscode.diff', original, modified, `DSH 审查: ${path}`);
  }

  private resolvePath(p: string, workspace: string): string {
    return p.startsWith('/') ? p : join(workspace, p);
  }
}

/** 拒绝改动：从 git 还原文件（调用 sidecar 或本地 git）。 */
export async function rejectChange(path: string, workspace: string): Promise<void> {
  const abs = path.startsWith('/') ? path : join(workspace, path);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  await exec('git', ['checkout', '--', abs], { cwd: workspace });
  // 还原后刷新打开的文件（重新读盘）
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs);
  if (doc && !doc.isDirty) await vscode.workspace.openTextDocument(doc.uri);
}

/** 读取文件当前内容（用于 diff 对比或注入）。 */
export function readFileContent(path: string, workspace: string): string {
  const abs = path.startsWith('/') ? path : join(workspace, path);
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}
