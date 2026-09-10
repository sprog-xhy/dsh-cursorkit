import { describe, it, expect } from 'vitest';
import { parseSettingsProviders } from '../src/rpc/router.ts';

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
