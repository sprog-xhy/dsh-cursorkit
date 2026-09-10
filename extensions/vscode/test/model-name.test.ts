/**
 * webview 类型工具测试（types.ts 无 vscode 依赖）：模型名拼装/显示。
 * 覆盖 BUG：原先选择模型时硬编码 `wps/` 前缀，非 wps provider 的模型会拼错。
 */
import { describe, it, expect } from 'vitest';
import { fullModelName, shortModelName } from '../webview/src/types.ts';

describe('fullModelName', () => {
  it('使用模型自带 provider（而非硬编码 wps）', () => {
    expect(fullModelName({ id: 'moonshot/kimi-k2.7-code', name: 'x', provider: 'wps' })).toBe(
      'wps/moonshot/kimi-k2.7-code',
    );
    expect(fullModelName({ id: 'deepseek-v4-flash', name: 'x', provider: 'deepseek' })).toBe(
      'deepseek/deepseek-v4-flash',
    );
  });

  it('无 provider 时退化为裸 id', () => {
    expect(fullModelName({ id: 'bare-model', name: 'x' })).toBe('bare-model');
  });
});

describe('shortModelName', () => {
  it('取最后一段用于顶栏显示', () => {
    expect(shortModelName('wps/moonshot/kimi-k2.7-code')).toBe('kimi-k2.7-code');
    expect(shortModelName('kimi')).toBe('kimi');
  });
});
