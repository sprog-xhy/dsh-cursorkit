/**
 * markdown 渲染测试（修复"有些 md 没渲染"）。
 */
import { describe, it, expect } from 'vitest';
import { renderMd, renderInline } from '../webview/src/markdown.ts';

describe('renderInline', () => {
  it('粗体 / 斜体 / 行内代码 / 删除线', () => {
    expect(renderInline('**b**')).toBe('<b>b</b>');
    expect(renderInline('*i*')).toBe('<i>i</i>');
    expect(renderInline('`x`')).toBe('<code>x</code>');
    expect(renderInline('~~d~~')).toBe('<del>d</del>');
  });

  it('链接（仅 http/https）', () => {
    expect(renderInline('[t](https://a.com)')).toContain('<a href="https://a.com"');
    expect(renderInline('[t](javascript:alert(1))')).not.toContain('<a ');
  });

  it('转义 HTML（防注入）', () => {
    expect(renderInline('<img src=x onerror=alert(1)>')).not.toContain('<img');
    expect(renderInline('a & b')).toBe('a &amp; b');
  });

  it('行内代码内部的格式不被二次解析', () => {
    expect(renderInline('`**not bold**`')).toBe('<code>**not bold**</code>');
  });
});

describe('renderMd 块级', () => {
  it('标题 # ## ###', () => {
    expect(renderMd('# 一级')).toContain('md-h1');
    expect(renderMd('## 二级')).toContain('md-h2');
    expect(renderMd('### 三级')).toContain('md-h3');
  });

  it('代码围栏带语言标签', () => {
    const html = renderMd('```ts\nconst a = 1;\n```');
    expect(html).toContain('md-lang');
    expect(html).toContain('>ts<');
    expect(html).toContain('<pre>const a = 1;</pre>');
  });

  it('无序 / 有序 / 嵌套列表', () => {
    expect(renderMd('- a\n- b')).toContain('<ul class="md-list">');
    expect(renderMd('1. a\n2. b')).toContain('<ol class="md-list">');
    const nested = renderMd('- a\n  - b');
    expect((nested.match(/<ul/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('引用 / 分隔线 / 表格', () => {
    expect(renderMd('> 引用')).toContain('md-quote');
    expect(renderMd('---')).toContain('md-hr');
    const table = renderMd('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(table).toContain('<table');
    expect(table).toContain('<th>a</th>');
    expect(table).toContain('<td>1</td>');
  });

  it('段落与换行', () => {
    const html = renderMd('第一行\n第二行');
    expect(html).toContain('<p>');
    expect(html).toContain('<br>');
  });

  it('代码块里的 markdown 不被渲染', () => {
    const html = renderMd('```\n# not a heading\n**not bold**\n```');
    expect(html).not.toContain('md-h1');
    expect(html).not.toContain('<b>');
    expect(html).toContain('# not a heading');
  });

  it('空输入 → 空串', () => {
    expect(renderMd('')).toBe('');
  });
});
