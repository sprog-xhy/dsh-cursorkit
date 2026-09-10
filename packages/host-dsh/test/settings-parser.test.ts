import { describe, it, expect } from 'vitest';
import {
  parseSettingsProviders,
  parseConfiguredDefaultModel,
  effectiveDefaultModel,
  setConfiguredDefaultModel,
  DEFAULT_MODEL,
} from '../src/rpc/router.ts';

const SAMPLE = `
ui-onboarding:
  welcomeNoticeVersion: '2026-08-13.1'
llm-pi-ai:
  providers:
    wps:
      apiKeyEnv: WPS_API_KEY
      api: openai-completions
      baseURL: https://ai-kas.kso.net/codeplan/v1
      models:
        - id: moonshot/kimi-k2.5
          contextWindow: 230000
        - id: deepseek/deepseek-v4-pro
          contextWindow: 1000000
    deepseek:
      apiKeyEnv: DEEPSEEK_API_KEY
      models:
        - id: deepseek-v4-flash
`;

describe('parseSettingsProviders', () => {
  it('解析 provider×model 列表', () => {
    const models = parseSettingsProviders(SAMPLE);
    expect(models).toHaveLength(3);
    expect(models[0]).toEqual({ id: 'moonshot/kimi-k2.5', name: 'moonshot/kimi-k2.5', provider: 'wps' });
    expect(models[2]).toEqual({ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', provider: 'deepseek' });
  });

  it('空/无 providers 返回 []', () => {
    expect(parseSettingsProviders('')).toEqual([]);
    expect(parseSettingsProviders('other: 1\nfoo: bar')).toEqual([]);
  });

  it('忽略注释与空行', () => {
    const models = parseSettingsProviders('# comment\n\nllm-pi-ai:\n  providers:\n    p:\n      models:\n        - id: a/b\n');
    expect(models).toEqual([{ id: 'a/b', name: 'a/b', provider: 'p' }]);
  });
});

describe('parseConfiguredDefaultModel（跟随 dsh 配置的默认模型）', () => {
  it('读取 agent-default-model.model', () => {
    const yaml = ['providers:', '  wps:', '    models: [a]', 'agent-default-model:', '  model: deepseek/deepseek-v4-flash-0731', 'other: 1'].join('\n');
    expect(parseConfiguredDefaultModel(yaml)).toBe('deepseek/deepseek-v4-flash-0731');
  });

  it('没有该段时返回 undefined', () => {
    expect(parseConfiguredDefaultModel('providers:\n  wps:\n    x: 1')).toBeUndefined();
  });

  it('后续同级键结束该段（不会误取别的 model）', () => {
    const yaml = ['agent-default-model:', '  temperature: 0.3', 'other:', '  model: wrong'].join('\n');
    expect(parseConfiguredDefaultModel(yaml)).toBeUndefined();
  });

  it('引号会被剥掉', () => {
    expect(parseConfiguredDefaultModel('agent-default-model:\n  model: "moonshot/kimi-k3"')).toBe('moonshot/kimi-k3');
  });
});

describe('effectiveDefaultModel（配置优先）', () => {
  it('未配置时用内置常量', () => {
    setConfiguredDefaultModel(undefined);
    expect(effectiveDefaultModel()).toBe(DEFAULT_MODEL);
  });

  it('配置为 provider/model 原样使用', () => {
    setConfiguredDefaultModel('wps/deepseek/deepseek-v4-flash-0731');
    expect(effectiveDefaultModel()).toBe('wps/deepseek/deepseek-v4-flash-0731');
  });

  it('配置缺少 provider 前缀时补 wps/', () => {
    setConfiguredDefaultModel('deepseek/deepseek-v4-flash-0731');
    expect(effectiveDefaultModel()).toBe('wps/deepseek/deepseek-v4-flash-0731');
    setConfiguredDefaultModel(undefined);
  });
});
