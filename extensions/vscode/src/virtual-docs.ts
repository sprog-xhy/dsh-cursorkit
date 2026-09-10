/**
 * 虚拟文档 + git 原始内容（修复 BUG：审查 diff 两侧指向同一文件，diff 永远为空）。
 *
 * 提供两种"原始版本"内容源：
 * - git HEAD 版本（`git show HEAD:<rel>`）→ 与工作区文件 diff
 * - 任意文本快照（Ctrl+K 预览的 before/after）→ 双虚拟文档 diff
 *
 * 用 TextDocumentContentProvider（而非临时文件/untitled）：
 * 不落地临时文件、不污染"打开的编辑器"，内容按需从缓存提供。
 */
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, relative, basename } from 'node:path';

const exec = promisify(execFile);

/** 虚拟文档 scheme。 */
export const VIRTUAL_SCHEME = 'dsh-virtual';

/** 虚拟文档内容提供器（按 uri 缓存内容）。 */
export class VirtualDocProvider implements vscode.TextDocumentContentProvider {
  private readonly cache = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  /** VSCode 要求的变更事件（内容更新后刷新已打开的 diff）。 */
  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.cache.get(uri.toString()) ?? '';
  }

  /** 写入内容并返回可直接用于 diff 的 URI。 */
  put(absPath: string, rev: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: VIRTUAL_SCHEME, path: absPath, query: rev });
    this.cache.set(uri.toString(), content);
    return uri;
  }

  clear(): void {
    this.cache.clear();
  }

  dispose(): void {
    this.emitter.dispose();
    this.cache.clear();
  }
}

/** 读取文件在 git HEAD 的内容；失败（未纳入 git / 新文件）返回 null。 */
export async function readGitHead(workspace: string, absPath: string): Promise<string | null> {
  const rel = isAbsolute(absPath) ? relative(workspace, absPath) : absPath;
  if (!rel || rel.startsWith('..')) return null;
  try {
    const { stdout } = await exec('git', ['show', `HEAD:${rel}`], {
      cwd: workspace,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * 打开"原始版本 ↔ 工作区文件"的 diff。
 * @returns 是否成功打开（git 未跟踪的文件返回 false，调用方可退化到 patch 视图）。
 */
export async function showWorkingTreeDiff(
  provider: VirtualDocProvider,
  workspace: string,
  absPath: string,
): Promise<boolean> {
  const head = await readGitHead(workspace, absPath);
  if (head === null) return false;
  const left = provider.put(absPath, `HEAD:${Date.now()}`, head);
  await vscode.commands.executeCommand(
    'vscode.diff',
    left,
    vscode.Uri.file(absPath),
    `${basename(absPath)}（HEAD ↔ 工作区）`,
    { preview: true },
  );
  return true;
}

/** 打开两个文本快照的 diff（Ctrl+K 预览：改前 ↔ 改后）。 */
export async function showSnapshotDiff(
  provider: VirtualDocProvider,
  absPath: string,
  before: string,
  after: string,
  title: string,
): Promise<void> {
  const stamp = Date.now();
  const left = provider.put(absPath, `before:${stamp}`, before);
  const right = provider.put(absPath, `after:${stamp}`, after);
  await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
}

/** 在只读虚拟文档中打开统一 diff 文本（git 未跟踪文件退化为 patch 视图）。 */
export async function showPatchDoc(
  provider: VirtualDocProvider,
  absPath: string,
  patch: string,
): Promise<void> {
  const uri = provider.put(absPath, `patch:${Date.now()}`, patch);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: true });
}
