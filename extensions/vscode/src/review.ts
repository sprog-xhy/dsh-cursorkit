/**
 * 审查闭环（V2-DECISIONS D6/D11/D28）：
 * agent 写文件（file.changed）→ 记录改动 + 冲突检测 → diff 视图 → 还原。
 *
 * 关键修复：
 * - diff 两侧不再是同一文件（原先 original/modified 都指向工作区文件 → diff 永远为空）
 *   → 用 VirtualDocProvider + git HEAD 内容做左侧
 * - 补齐 D28：agent 覆盖用户未保存的修改时提示冲突
 * - git 未跟踪的新文件：diff 退化为 patch 视图；还原退化为删除文件（需确认）
 */
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, relative } from 'node:path';
import {
  VirtualDocProvider,
  showWorkingTreeDiff,
  showPatchDoc,
} from './virtual-docs.ts';

const exec = promisify(execFile);

export interface FileChangeEvent {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
  status: string;
}

/** 冲突信息（agent 改动与用户未保存修改撞车）。 */
export interface ChangeConflict {
  path: string;
  absPath: string;
}

/** diff 打开结果（供上层给用户反馈）。 */
export type DiffOutcome = 'diff' | 'patch' | 'not-found';

/** 记录会话最近的改动（供审查面板/命令使用）。 */
export class ChangeTracker {
  private changes = new Map<string, FileChangeEvent>();

  constructor(private readonly provider: VirtualDocProvider) {}

  /**
   * file.changed 事件处理：记录改动 + 冲突检测。
   * @returns 若磁盘改动撞上未保存的编辑器缓冲区，返回冲突信息
   */
  handleFileChanged(change: FileChangeEvent, workspace: string): ChangeConflict | null {
    this.changes.set(change.path, change);
    const abs = resolvePath(change.path, workspace);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs);
    if (doc?.isDirty) {
      // agent 覆盖了用户的未保存修改 → 需要用户决策（D28）
      return { path: change.path, absPath: abs };
    }
    return null;
  }

  /** 列出会话全部改动。 */
  list(): FileChangeEvent[] {
    return [...this.changes.values()];
  }

  /** 单个改动（用于 patch 退化视图）。 */
  get(path: string): FileChangeEvent | undefined {
    return this.changes.get(path);
  }

  remove(path: string): void {
    this.changes.delete(path);
  }

  /**
   * 保留（Keep）：接受 agent 的改动 —— 文件保持现状，仅从「待审查」列表移除。
   *
   * 与「撤销（Undo）」配对，对齐 Cursor 的 Keep/Undo 语义：
   * agent 写文件时改动已落盘，Keep 表示"我确认接受"，于是不再属于待处理项。
   * @returns 是否确实有待处理项被保留
   */
  accept(path: string): boolean {
    if (!this.changes.has(path)) return false;
    this.changes.delete(path);
    return true;
  }

  /** 全部保留；返回被保留的路径。 */
  acceptAll(): string[] {
    const paths = [...this.changes.keys()];
    this.changes.clear();
    return paths;
  }

  clear(): void {
    this.changes.clear();
  }

  /**
   * 打开审查 diff：git HEAD ↔ 工作区文件。
   * git 未跟踪的新文件退化为统一 diff 文本视图。
   */
  async showDiff(path: string, workspace: string): Promise<DiffOutcome> {
    const abs = resolvePath(path, workspace);
    const opened = await showWorkingTreeDiff(this.provider, workspace, abs);
    if (opened) return 'diff';
    const change = this.changes.get(path);
    if (change?.patch?.trim()) {
      await showPatchDoc(this.provider, abs, change.patch);
      return 'patch';
    }
    return 'not-found';
  }
}

/**
 * 冲突决策（D28）：用户未保存的修改被 agent 覆盖。
 * @returns 用户的选择
 */
export async function resolveConflict(
  conflict: ChangeConflict,
  workspace: string,
  tracker: ChangeTracker,
): Promise<'diff' | 'revert' | 'keep' | 'dismissed'> {
  const choice = await vscode.window.showWarningMessage(
    `agent 修改了 ${conflict.path}，但你在编辑器里有未保存的更改`,
    { modal: true },
    '查看差异',
    '丢弃我的修改并重载',
    '保留我的修改',
  );
  if (choice === '查看差异') {
    await tracker.showDiff(conflict.path, workspace);
    return 'diff';
  }
  if (choice === '丢弃我的修改并重载') {
    await vscode.commands.executeCommand('workbench.action.files.revert', vscode.Uri.file(conflict.absPath));
    return 'revert';
  }
  if (choice === '保留我的修改') return 'keep';
  return 'dismissed';
}

/** 还原结果。 */
export type RejectOutcome = 'reverted' | 'deleted' | 'failed' | 'cancelled';

/**
 * 拒绝改动：从 git HEAD 还原文件。
 * 未纳入 git 的新文件 → 询问后删除（避免"还原"静默失败）。
 */
export async function rejectChange(
  path: string,
  workspace: string,
  provider: VirtualDocProvider,
): Promise<RejectOutcome> {
  const abs = resolvePath(path, workspace);
  const rel = isAbsolute(path) ? relative(workspace, abs) : path;
  if (!rel || rel.startsWith('..')) return 'failed';

  // 1. 已跟踪文件：git checkout HEAD -- <rel>
  const tracked = await isTracked(workspace, rel);
  if (tracked) {
    try {
      await exec('git', ['checkout', 'HEAD', '--', rel], { cwd: workspace });
      await reloadDoc(abs);
      return 'reverted';
    } catch {
      return 'failed';
    }
  }

  // 2. 未跟踪的新文件：删除（需用户确认，避免误删）
  const confirm = await vscode.window.showWarningMessage(
    `${rel} 是 agent 新建的文件（未纳入 git）。删除它？`,
    { modal: true },
    '删除',
  );
  if (confirm !== '删除') return 'cancelled';
  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(abs), { useTrash: true });
    provider.clear();
    return 'deleted';
  } catch {
    return 'failed';
  }
}

/** 文件是否被 git 跟踪。 */
async function isTracked(workspace: string, rel: string): Promise<boolean> {
  try {
    await exec('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: workspace });
    return true;
  } catch {
    return false;
  }
}

/** 还原后刷新打开的编辑器缓冲区。 */
async function reloadDoc(abs: string): Promise<void> {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs);
  if (doc && !doc.isDirty) {
    await vscode.commands.executeCommand('workbench.action.files.revert', vscode.Uri.file(abs));
  }
}

function resolvePath(p: string, workspace: string): string {
  return isAbsolute(p) ? p : join(workspace, p);
}
