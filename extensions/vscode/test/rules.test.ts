/**
 * rules.ts 纯逻辑测试（V2-DECISIONS D12）：rulesToPrompt 组合。
 * loadRules 依赖文件系统 + vscode，不直接测。
 */
import { describe, it, expect } from 'vitest';

interface RulesBundle {
  global: string;
  project: string[];
}

// 与 rules.ts 相同的 rulesToPrompt 实现
function rulesToPrompt(rules: RulesBundle): string {
  const parts: string[] = [];
  if (rules.project.length > 0) parts.push(`【项目 Rules】\n${rules.project.join('\n\n')}`);
  if (rules.global.trim()) parts.push(`【全局 Rules】\n${rules.global}`);
  if (parts.length === 0) return '';
  return `\n\n以下规则必须遵守：\n${parts.join('\n\n')}`;
}

describe('rules (rulesToPrompt)', () => {
  it('项目+全局 rules 组合', () => {
    const prompt = rulesToPrompt({ global: 'g1', project: ['p1', 'p2'] });
    expect(prompt).toContain('p1');
    expect(prompt).toContain('p2');
    expect(prompt).toContain('g1');
    expect(prompt).toContain('【项目 Rules】');
    expect(prompt).toContain('【全局 Rules】');
  });

  it('无 rules 返回空串', () => {
    expect(rulesToPrompt({ global: '', project: [] })).toBe('');
  });

  it('只有项目 rules', () => {
    const prompt = rulesToPrompt({ global: '', project: ['only-project'] });
    expect(prompt).toContain('only-project');
    expect(prompt).not.toContain('【全局 Rules】');
  });

  it('只有全局 rules', () => {
    const prompt = rulesToPrompt({ global: 'only-global', project: [] });
    expect(prompt).toContain('only-global');
    expect(prompt).not.toContain('【项目 Rules】');
  });
});
