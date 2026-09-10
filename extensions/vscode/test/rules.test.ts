/**
 * rules.ts 真实实现测试（该模块无 vscode 依赖，可直接 import）。
 * 覆盖：frontmatter 解析、globs 匹配、规则过滤、提示词拼装、指纹。
 */
import { describe, it, expect } from 'vitest';
import {
  parseMdc,
  matchGlob,
  ruleApplies,
  rulesToPrompt,
  rulesFingerprint,
  type ProjectRule,
} from '../src/rules.ts';

describe('parseMdc', () => {
  it('解析 frontmatter（description/globs）并剥离出正文', () => {
    const parsed = parseMdc('---\ndescription: TS 规范\nglobs: src/**/*.ts,*.tsx\n---\n用 2 空格缩进。\n');
    expect(parsed.body).toBe('用 2 空格缩进。');
    expect(parsed.globs).toEqual(['src/**/*.ts', '*.tsx']);
    expect(parsed.description).toBe('TS 规范');
    expect(parsed.alwaysApply).toBe(false);
  });

  it('无 frontmatter 时视为总是生效', () => {
    const parsed = parseMdc('总是遵守这条规则。');
    expect(parsed.body).toBe('总是遵守这条规则。');
    expect(parsed.globs).toBeUndefined();
    expect(parsed.alwaysApply).toBe(true);
  });

  it('alwaysApply: true 且无 globs → 总是生效', () => {
    const parsed = parseMdc('---\nalwaysApply: true\n---\n正文');
    expect(parsed.alwaysApply).toBe(true);
    expect(parsed.globs).toBeUndefined();
  });

  it('带 BOM 的 frontmatter 也能解析', () => {
    const parsed = parseMdc('\uFEFF---\nglobs: a.ts\n---\nbody');
    expect(parsed.body).toBe('body');
    expect(parsed.globs).toEqual(['a.ts']);
  });
});

describe('matchGlob', () => {
  it('* 不跨目录', () => {
    expect(matchGlob('*.ts', 'index.ts')).toBe(true);
    expect(matchGlob('*.ts', 'src/index.ts')).toBe(false);
  });

  it('**/ 匹配任意层级（含零层）', () => {
    expect(matchGlob('src/**/*.ts', 'src/a.ts')).toBe(true);
    expect(matchGlob('src/**/*.ts', 'src/a/b/c.ts')).toBe(true);
    expect(matchGlob('src/**/*.ts', 'lib/a.ts')).toBe(false);
  });

  it('? 匹配单个字符', () => {
    expect(matchGlob('a?.ts', 'ab.ts')).toBe(true);
    expect(matchGlob('a?.ts', 'abc.ts')).toBe(false);
  });

  it('特殊字符被转义（不当作正则）', () => {
    expect(matchGlob('a+b.ts', 'a+b.ts')).toBe(true);
    expect(matchGlob('a+b.ts', 'aab.ts')).toBe(false);
  });
});

describe('ruleApplies / rulesToPrompt', () => {
  const globRule: ProjectRule = { name: 'ts.mdc', body: 'TS 规则', globs: ['**/*.ts'], alwaysApply: false };
  const alwaysRule: ProjectRule = { name: '.cursorrules', body: '通用规则', alwaysApply: true };

  it('glob 规则只对匹配文件生效', () => {
    expect(ruleApplies(globRule, 'src/a.ts')).toBe(true);
    expect(ruleApplies(globRule, 'src/a.py')).toBe(false);
  });

  it('无活动文件信息时不误杀 glob 规则', () => {
    expect(ruleApplies(globRule, undefined)).toBe(true);
  });

  it('提示词只包含适用规则', () => {
    const prompt = rulesToPrompt({ global: '', project: [globRule, alwaysRule] }, 'src/a.py');
    expect(prompt).toContain('通用规则');
    expect(prompt).not.toContain('TS 规则');
  });

  it('无规则时返回空串', () => {
    expect(rulesToPrompt({ global: '', project: [] }, 'a.ts')).toBe('');
  });

  it('全局规则总是包含', () => {
    const prompt = rulesToPrompt({ global: '全局约束', project: [globRule] }, 'a.py');
    expect(prompt).toContain('全局约束');
  });
});

describe('rulesFingerprint', () => {
  it('内容变化导致指纹变化（用于避免重复注入）', () => {
    const a = rulesFingerprint({ global: 'g', project: [{ name: 'x', body: 'b1', alwaysApply: true }] });
    const b = rulesFingerprint({ global: 'g', project: [{ name: 'x', body: 'b2', alwaysApply: true }] });
    expect(a).not.toBe(b);
  });

  it('相同内容指纹稳定', () => {
    const mk = (): string =>
      rulesFingerprint({ global: 'g', project: [{ name: 'x', body: 'b', alwaysApply: true }] });
    expect(mk()).toBe(mk());
  });
});
