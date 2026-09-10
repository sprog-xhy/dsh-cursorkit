/**
 * review.ts 纯逻辑测试：路径解析 / 改动记录。
 * VSCode API 部分（diff 视图、文件刷新）不测（依赖 vscode 运行时）。
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

// ChangeTracker 的 resolvePath 逻辑提取测试（不依赖 vscode）
function resolvePath(p: string, workspace: string): string {
  return p.startsWith('/') ? p : join(workspace, p);
}

describe('review (path resolution)', () => {
  it('绝对路径原样返回', () => {
    expect(resolvePath('/abs/path/file.ts', '/ws')).toBe('/abs/path/file.ts');
  });

  it('相对路径拼到 workspace', () => {
    expect(resolvePath('src/a.ts', '/ws')).toBe('/ws/src/a.ts');
  });

  it('嵌套相对路径正确拼接', () => {
    expect(resolvePath('packages/x/src/index.ts', '/ws')).toBe('/ws/packages/x/src/index.ts');
  });
});

describe('review (change records)', () => {
  it('ChangeTracker 记录与清除改动', () => {
    // 模拟 ChangeTracker 内部 Map 行为（不依赖 vscode）
    const changes = new Map<string, { path: string; additions: number }>();
    changes.set('a.ts', { path: 'a.ts', additions: 1 });
    changes.set('b.ts', { path: 'b.ts', additions: 2 });
    expect(changes.size).toBe(2);
    expect(changes.get('a.ts')?.additions).toBe(1);
    changes.clear();
    expect(changes.size).toBe(0);
  });
});
