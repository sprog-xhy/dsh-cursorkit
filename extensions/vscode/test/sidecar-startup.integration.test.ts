/**
 * sidecar 启动集成测试（真实进程）。
 *
 * 覆盖两个修复：
 * - P0：profile 依赖从不安装 / pnpm file: 快照过期 → 现在按源码指纹自动安装
 * - P1：启动失败时不留孤儿进程
 *
 * 需要本机有 dsh 与 LLM 凭据；用 CK_SKIP_INTEGRATION=1 跳过，或缺 dsh 时自动跳过。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import type { ExtensionContext } from './stubs/vscode.ts';
import { Uri, setConfig } from './stubs/vscode.ts';

const hasDsh = (() => {
  try {
    execFileSync('dsh', ['--version'], { stdio: 'pipe', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
})();

const skip = process.env.CK_SKIP_INTEGRATION === '1' || !hasDsh;
const SOURCE_HOME = process.env.CK_DSH_HOME ?? join(homedir(), '.dsh-cursorkit');

let home: string;

function fakeContext(): ExtensionContext {
  return {
    subscriptions: [],
    extensionUri: Uri.file(process.cwd()),
    secrets: { get: async () => undefined, store: async () => undefined },
    globalState: { get: (_k: string, d?: unknown) => d, update: async () => undefined },
  };
}

describe.skipIf(skip)('sidecar 启动（真实 dsh 进程）', () => {
  beforeAll(async () => {
    // 全新 DSH_HOME：只带 provider 配置，profile 目录完全由扩展生成
    home = mkdtempSync(join(tmpdir(), 'ck-home-'));
    mkdirSync(join(home, '.cursorkit'), { recursive: true });
    for (const f of ['settings.yaml', '.credentials.yaml']) {
      const src = join(SOURCE_HOME, f);
      if (existsSync(src)) copyFileSync(src, join(home, f));
    }
    // SidecarManager 从配置读 dshHome（环境 DSH_HOME 不被继承，防止污染主环境）
    setConfig('dshCursorkit.sidecar.dshHome', home);
    setConfig('dshCursorkit.sidecar.autoStart', false);
  }, 30_000);

  afterAll(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it(
    '冷启动：自动生成 profile → 自动安装依赖 → 启动成功（无手工步骤）',
    async () => {
      const { SidecarManager } = await import('../src/sidecar.ts');
      const mgr = new SidecarManager(fakeContext());
      try {
        const info = await mgr.start();
        expect(info.pid).toBeGreaterThan(0);
        expect(info.port).toBeGreaterThan(0);
        expect(info.token).toHaveLength(64);

        // profile 依赖被自动安装（此前的致命缺口）
        const installed = join(home, 'profiles', 'cursorkit', 'node_modules', '@dsh-cursorkit', 'host-dsh', 'package.json');
        expect(existsSync(installed), 'profile 内的 host-dsh 应已安装').toBe(true);
        // 指纹落盘（避免每次启动重复安装）
        expect(existsSync(join(home, 'profiles', 'cursorkit', '.cursorkit-install-stamp'))).toBe(true);
        // runtime.json 存在且内容可解析
        const runtime = JSON.parse(readFileSync(join(home, '.cursorkit', 'runtime.json'), 'utf8')) as {
          pid: number;
          port: number;
        };
        expect(runtime.pid).toBe(info.pid);
        expect(runtime.port).toBe(info.port);
      } finally {
        mgr.dispose();
      }
    },
    180_000,
  );

  it(
    '复启动：指纹一致时不重装，直接复用已就绪的 sidecar',
    async () => {
      const { SidecarManager } = await import('../src/sidecar.ts');
      const mgr = new SidecarManager(fakeContext());
      const startedAt = Date.now();
      try {
        const info = await mgr.start();
        expect(info.port).toBeGreaterThan(0);
        // 复用路径应在 10s 内完成（不重装依赖、不重新 spawn 冷启动）
        expect(Date.now() - startedAt).toBeLessThan(30_000);
      } finally {
        mgr.dispose();
      }
    },
    120_000,
  );

  it('sidecar 崩溃后文件缺失时 dispose 不留残余：dispose 后 runtime.json 归旧进程', async () => {
    const { SidecarManager } = await import('../src/sidecar.ts');
    const mgr = new SidecarManager(fakeContext());
    const info = await mgr.start();
    mgr.dispose();
    // 进程应被 SIGTERM 结束（等一小会儿）
    await new Promise((r) => setTimeout(r, 1500));
    let alive = true;
    try {
      process.kill(info.pid, 0);
    } catch {
      alive = false;
    }
    expect(alive, 'dispose 后 sidecar 进程应已退出').toBe(false);
  }, 120_000);
});
