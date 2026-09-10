/**
 * 方法表一致性测试。
 *
 * 真实 bug：新增了 method 的类型定义与 router handler，却忘了加入运行时常量
 * `CKP_METHODS` → 客户端调用时得到 `unknown method`（context.get 曾长期如此）。
 * 这里从 router 源码里抽取所有 register('...') 的方法名，逐个校验。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CKP_METHODS } from '@dsh-cursorkit/protocol';

const routerSrc = readFileSync(join(__dirname, '..', 'src', 'rpc', 'router.ts'), 'utf8');

/** 抽取 router 中注册的所有方法名。 */
function registeredMethods(): string[] {
  const found = new Set<string>();
  for (const m of routerSrc.matchAll(/this\.register\(\s*'([^']+)'/g)) found.add(m[1]);
  return [...found];
}

describe('CKP 方法表一致性', () => {
  it('router 注册的每个方法都在 CKP_METHODS 里（否则运行时报 unknown method）', () => {
    const registered = registeredMethods();
    expect(registered.length).toBeGreaterThan(20);
    const missing = registered.filter((m) => !(CKP_METHODS as readonly string[]).includes(m));
    expect(missing, `未登记的 method：${missing.join(', ')}`).toEqual([]);
  });

  it('CKP_METHODS 里不应有 router 未实现的方法（否则调用必失败）', () => {
    const registered = new Set(registeredMethods());
    const unimplemented = (CKP_METHODS as readonly string[]).filter((m) => !registered.has(m));
    expect(unimplemented, `声明但未实现：${unimplemented.join(', ')}`).toEqual([]);
  });

  it('session.history 与 context.get 已登记（回归）', () => {
    expect(CKP_METHODS as readonly string[]).toContain('session.history');
    expect(CKP_METHODS as readonly string[]).toContain('context.get');
  });
});
