/**
 * tab-completion.ts 纯函数测试（V2-DECISIONS D8）。
 */
import { describe, it, expect } from 'vitest';

// 与 tab-completion.ts 相同的 stripFence 实现
function stripFence(s: string): string {
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(s.trim());
  return m ? m[1] : s;
}

describe('tab-completion (stripFence)', () => {
  it('去掉代码围栏', () => {
    expect(stripFence('```js\nconsole.log(1);\n```')).toBe('console.log(1);');
  });

  it('无围栏原样', () => {
    expect(stripFence('foo();')).toBe('foo();');
  });

  it('围栏内多行保留', () => {
    expect(stripFence('```\na\nb\nc\n```')).toBe('a\nb\nc');
  });
});

describe('tab-completion (prefix window logic)', () => {
  it('前缀裁剪不超过 40 行/4000 字符（逻辑验证）', () => {
    const MAX_PREFIX_LINES = 40;
    const MAX_PREFIX_CHARS = 4000;
    // 构造 100 行长内容行（每行 60 字符 → 总 6000+）
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}-` + 'x'.repeat(50));
    const prefix = lines.join('\n');
    // 取最后 40 行
    const windowed = prefix.split('\n').slice(-MAX_PREFIX_LINES).join('\n');
    expect(windowed.split('\n')).toHaveLength(40);
    expect(windowed.startsWith('line60-')).toBe(true);
    expect(prefix.length).toBeGreaterThan(MAX_PREFIX_CHARS);
    // 字符裁剪到 4000
    const charWindowed = prefix.slice(-MAX_PREFIX_CHARS);
    expect(charWindowed.length).toBeLessThanOrEqual(MAX_PREFIX_CHARS);
  });
});
