/**
 * parseModelRef 测试（修复：无 '/' 时原先产出 provider=整串 + model='' 的坏配置）。
 */
import { describe, it, expect } from 'vitest';
import { parseModelRef, DEFAULT_MODEL } from '../src/rpc/router.ts';

describe('parseModelRef', () => {
  it('provider/model 标准格式', () => {
    expect(parseModelRef('wps/moonshot/kimi-k2.7-code')).toEqual({
      provider: 'wps',
      model: 'moonshot/kimi-k2.7-code',
      full: 'wps/moonshot/kimi-k2.7-code',
    });
  });

  it('无 provider 的裸模型 id（原先会拼成坏配置）', () => {
    expect(parseModelRef('kimi-k2.7-code')).toEqual({
      model: 'kimi-k2.7-code',
      full: 'kimi-k2.7-code',
    });
  });

  it('空/空白 → 默认模型', () => {
    expect(parseModelRef(undefined).full).toBe(DEFAULT_MODEL);
    expect(parseModelRef('   ').full).toBe(DEFAULT_MODEL);
  });

  it('以 / 开头时不当作 provider', () => {
    expect(parseModelRef('/weird')).toEqual({ model: '/weird', full: '/weird' });
  });

  it('多段 model id 保留（不丢中间段）', () => {
    const r = parseModelRef('p/a/b/c');
    expect(r.provider).toBe('p');
    expect(r.model).toBe('a/b/c');
  });
});
