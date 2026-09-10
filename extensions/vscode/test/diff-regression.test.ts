/**
 * 审查 diff 回归测试（P0-1）。
 *
 * 历史缺陷：original/modified 指向**同一个文件 URI** → diff 永远为空。
 * 本测试在真实临时 git 仓库里验证：
 *  - readGitHead 能取到 HEAD 内容（改动前）
 *  - showWorkingTreeDiff 传给 vscode.diff 的左右两侧是**不同** URI
 *  - 左侧虚拟文档内容 = HEAD 版本，右侧 = 工作区文件
 *  - 未跟踪文件返回 false（调用方退化到 patch 视图）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { executedCommands } from './stubs/vscode.ts';
import {
  VirtualDocProvider,
  readGitHead,
  showWorkingTreeDiff,
  showSnapshotDiff,
  VIRTUAL_SCHEME,
} from '../src/virtual-docs.ts';

let repo: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ck-diff-'));
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(repo, 'a.ts'), 'const a = 1;\n', 'utf8');
  git('add', 'a.ts');
  git('commit', '-q', '-m', 'init');
  executedCommands.length = 0;
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('readGitHead', () => {
  it('返回 HEAD 版本内容（工作区改动后仍取到改动前）', async () => {
    writeFileSync(join(repo, 'a.ts'), 'const a = 2;\nconst b = 3;\n', 'utf8');
    const head = await readGitHead(repo, join(repo, 'a.ts'));
    expect(head).toBe('const a = 1;\n');
  });

  it('未跟踪文件返回 null', async () => {
    writeFileSync(join(repo, 'new.ts'), 'x\n', 'utf8');
    expect(await readGitHead(repo, join(repo, 'new.ts'))).toBeNull();
  });

  it('仓库外路径返回 null（不抛错）', async () => {
    expect(await readGitHead(repo, '/etc/hostname')).toBeNull();
  });
});

describe('showWorkingTreeDiff（P0-1 回归）', () => {
  it('传给 vscode.diff 的左右两侧必须是不同 URI', async () => {
    const abs = join(repo, 'a.ts');
    writeFileSync(abs, 'const a = 2;\n', 'utf8');
    const provider = new VirtualDocProvider();

    const ok = await showWorkingTreeDiff(provider, repo, abs);
    expect(ok).toBe(true);

    const diffCall = executedCommands.find((c) => c.command === 'vscode.diff');
    expect(diffCall, '应该调用 vscode.diff').toBeTruthy();
    const [left, right] = diffCall!.args as [{ toString(): string }, { toString(): string }];
    expect(left.toString()).not.toBe(right.toString()); // ← 核心断言：原先两者完全相同
    expect(left.toString()).toContain(VIRTUAL_SCHEME);
    expect(right.toString()).toContain('file:');
  });

  it('左侧虚拟文档内容 = HEAD 版本，右侧 = 工作区文件', async () => {
    const abs = join(repo, 'a.ts');
    writeFileSync(abs, 'const a = 2;\nconst b = 3;\n', 'utf8');
    const provider = new VirtualDocProvider();
    await showWorkingTreeDiff(provider, repo, abs);

    const diffCall = executedCommands.find((c) => c.command === 'vscode.diff');
    const [left, right] = diffCall!.args as [{ toString(): string }, { toString(): string }];
    // 通过 provider 回读内容：左侧应为改动前（HEAD），右侧为工作区（改动后）
    expect(provider.provideTextDocumentContent(left as never)).toBe('const a = 1;\n');
    expect(provider.provideTextDocumentContent(right as never)).not.toContain('const b = 3;');
  });

  it('未跟踪文件返回 false（调用方应退化到 patch 视图）', async () => {
    const abs = join(repo, 'untracked.ts');
    writeFileSync(abs, 'new\n', 'utf8');
    const provider = new VirtualDocProvider();
    expect(await showWorkingTreeDiff(provider, repo, abs)).toBe(false);
  });
});

describe('showSnapshotDiff（Ctrl+K 预览）', () => {
  it('左右为两个不同虚拟文档', async () => {
    executedCommands.length = 0;
    const provider = new VirtualDocProvider();
    await showSnapshotDiff(provider, '/tmp/a.ts', 'before()', 'after()', '标题');
    const diffCall = executedCommands.find((c) => c.command === 'vscode.diff');
    expect(diffCall).toBeTruthy();
    const [left, right] = diffCall!.args as [{ toString(): string }, { toString(): string }];
    expect(left.toString()).not.toBe(right.toString());
    expect(provider.provideTextDocumentContent(left as never)).toBe('before()');
    expect(provider.provideTextDocumentContent(right as never)).toBe('after()');
  });
});
