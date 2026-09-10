/**
 * edit-code.ts 纯函数测试（V2-DECISIONS D9）。
 */
import { describe, it, expect } from 'vitest';

// 与 edit-code.ts 相同的 stripFence 实现（避免依赖 vscode）
function stripFence(s: string): string {
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(s.trim());
  return m ? m[1] : s;
}

describe('edit-code (stripFence)', () => {
  it('去掉带语言标识的代码围栏', () => {
    expect(stripFence('```ts\nconst a = 1;\n```')).toBe('const a = 1;');
  });

  it('无围栏时原样返回', () => {
    const s = 'const a = 1;';
    expect(stripFence(s)).toBe(s);
  });

  it('保留围栏内的多行', () => {
    expect(stripFence('```\nline1\nline2\n```')).toBe('line1\nline2');
  });

  it('围栏不闭合时原样返回', () => {
    const s = '```ts\nconst a = 1;';
    expect(stripFence(s)).toBe(s);
  });
});
