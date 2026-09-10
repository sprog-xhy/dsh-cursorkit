/**
 * 会话管理：重命名 / 删除（用户选的 Cursor 对齐项）。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Router, type RouterServices } from '../src/rpc/router.ts';
import { SessionIndex } from '../src/session-index.ts';
import { EventBus } from '../src/rpc/sse.ts';
import { ApprovalBridge } from '../src/bridge/approval-bridge.ts';
import type { CapabilityReport } from '../src/capability.ts';

const report: CapabilityReport = {
  dshVersion: '0.1.1-rc.2',
  required: { ok: true, missing: [] },
  optional: {},
  probedAt: new Date().toISOString(),
};

function harness(opts: { live?: boolean; withFiles?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ck-manage-'));
  const index = new SessionIndex({ file: join(home, '.cursorkit', 'session-index.json'), debounceMs: 1 });
  index.set('s1', { model: 'm/a', workspace: '/ws', createdAt: 1 });
  index.setTitle('s1', '自动标题');

  if (opts.withFiles) {
    const dir = join(home, 'sessions', '--ws--', 's1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session.jsonl.zstd'), 'x');
  }

  const bus = new EventBus();
  const services: RouterServices = {
    sessions: {
      get: (id: string) => (opts.live && id === 's1' ? { id, header: { cwd: '/ws', createdAt: 1 }, seq: 5 } : undefined),
      list: () => [],
      create: () => ({ id: 'x', header: { cwd: '/ws', createdAt: 1 }, seq: 0 }),
    } as never,
    agents: { get: () => undefined, list: () => [] } as never,
    approvals: new ApprovalBridge({ bus }),
    bus,
    capabilities: report,
    dshVersion: '0.1.1-rc.2',
    dshHome: home,
    sessionIndex: index,
  };
  return { router: new Router(services), index, home };
}

describe('session.rename', () => {
  it('用户重命名生效并标记 titleSource=user', async () => {
    const h = harness();
    await h.router.dispatch('session.rename', { id: 's1', title: '我的标题' });
    expect(h.index.titleOf('s1')).toBe('我的标题');
    expect(h.index.get('s1')?.titleSource).toBe('user');
  });

  it('用户标题不被后续自动标题覆盖（dsh 标题晚到的场景）', async () => {
    const h = harness();
    await h.router.dispatch('session.rename', { id: 's1', title: '我的标题' });
    h.index.setTitle('s1', 'dsh 自动生成');
    expect(h.index.titleOf('s1')).toBe('我的标题');
  });

  it('空标题报 INVALID_PARAMS', async () => {
    const h = harness();
    await expect(h.router.dispatch('session.rename', { id: 's1', title: '   ' })).rejects.toThrow();
  });

  it('清洗模式提示污染', async () => {
    const h = harness();
    await h.router.dispatch('session.rename', { id: 's1', title: '修白屏 [模式: Agent] xxx' });
    expect(h.index.titleOf('s1')).toBe('修白屏');
  });
});

describe('session.delete', () => {
  it('从索引移除；默认不动磁盘文件', async () => {
    const h = harness({ withFiles: true });
    const res = await h.router.dispatch('session.delete', { id: 's1' });
    expect(res.removedFiles).toBe(false);
    expect(h.index.get('s1')).toBeUndefined();
    expect(existsSync(join(h.home, 'sessions', '--ws--', 's1'))).toBe(true);
  });

  it('deleteFiles=true 时删除磁盘日志', async () => {
    const h = harness({ withFiles: true });
    const res = await h.router.dispatch('session.delete', { id: 's1', deleteFiles: true });
    expect(res.removedFiles).toBe(true);
    expect(existsSync(join(h.home, 'sessions', '--ws--', 's1'))).toBe(false);
  });

  it('正在运行的会话拒绝删除（SESSION_BUSY）', async () => {
    const h = harness({ live: true });
    await expect(h.router.dispatch('session.delete', { id: 's1' })).rejects.toThrow(/运行/);
    expect(h.index.get('s1')).toBeDefined();
  });
});
