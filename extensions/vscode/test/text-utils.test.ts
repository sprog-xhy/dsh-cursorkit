/**
 * text-utils 真实实现测试（无 vscode 依赖）。
 */
import { describe, it, expect } from 'vitest';
import { stripFence, extractCodeBlock, tailChars, truncate } from '../src/text-utils.ts';

describe('stripFence', () => {
  it('去掉带语言标识的围栏', () => {
    expect(stripFence('```ts\nconst a = 1;\n```')).toBe('const a = 1;');
  });

  it('去掉无语言标识的围栏', () => {
    expect(stripFence('```\nline1\nline2\n```')).toBe('line1\nline2');
  });

  it('支持 CRLF', () => {
    expect(stripFence('```ts\r\nconst a = 1;\r\n```')).toBe('const a = 1;');
  });

  it('无围栏时返回 trim 后的原文', () => {
    expect(stripFence('  foo();  ')).toBe('foo();');
  });

  it('未闭合围栏时原样返回', () => {
    expect(stripFence('```ts\nconst a = 1;')).toBe('```ts\nconst a = 1;');
  });

  it('去除首尾空白（模型常带空行）', () => {
    expect(stripFence('\n\n```\nx\n```\n\n')).toBe('x');
  });
});

describe('extractCodeBlock', () => {
  it('从解释性回复中抽出代码块', () => {
    const s = '这里是修改后的代码：\n```ts\nconst a = 1;\n```\n希望对你有帮助';
    expect(extractCodeBlock(s)).toBe('const a = 1;');
  });

  it('无围栏时返回 trim 原文', () => {
    expect(extractCodeBlock('  plain  ')).toBe('plain');
  });
});

describe('tailChars / truncate', () => {
  it('tailChars 保留末尾', () => {
    expect(tailChars('abcdef', 3)).toBe('def');
    expect(tailChars('ab', 5)).toBe('ab');
  });

  it('truncate 超长加省略号', () => {
    expect(truncate('abcdef', 3)).toBe('abc…');
    expect(truncate('ab', 5)).toBe('ab');
  });
});
