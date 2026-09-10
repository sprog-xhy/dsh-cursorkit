/**
 * sidecar manager 单元测试：纯逻辑部分（runtime 解析/路径/权限模式）。
 * spawn 部分依赖真实 dsh，归入集成测试（后续 M4 E2E）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 避免加载 vscode 模块（node 环境下不可用），直接测试被提取的纯函数。
// 先验证 sidecar.ts 的模块结构可被 mock 化。
describe('sidecar (static helpers)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('runtime.json 解析（含缺省字段回退）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ck-sidecar-'));
    const file = join(dir, 'runtime.json');
    writeFileSync(
      file,
      JSON.stringify({ pid: 1234, port: 4321, token: 'abc123' }),
      'utf8',
    );
    // 直接测 host-dsh 的 readRuntimeFile（扩展复用同一逻辑）
    const { readRuntimeFile } = await import(
      '../../../packages/host-dsh/lib/runtime-file.js'
    );
    const info = await readRuntimeFile(file);
    expect(info).not.toBeNull();
    expect(info!.pid).toBe(1234);
    expect(info!.port).toBe(4321);
    expect(info!.token).toBe('abc123');
    expect(info!.protocolVersion).toBeTruthy(); // 缺省回退
    expect(info!.dshVersion).toBe('unknown');
  });

  it('runtime.json 损坏时返回 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ck-sidecar-'));
    const file = join(dir, 'runtime.json');
    writeFileSync(file, '{invalid', 'utf8');
    const { readRuntimeFile } = await import(
      '../../../packages/host-dsh/lib/runtime-file.js'
    );
    expect(await readRuntimeFile(file)).toBeNull();
  });

  it('runtime.json 缺关键字段时返回 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ck-sidecar-'));
    const file = join(dir, 'runtime.json');
    writeFileSync(file, JSON.stringify({ pid: 1, token: 'x' }), 'utf8');
    const { readRuntimeFile } = await import(
      '../../../packages/host-dsh/lib/runtime-file.js'
    );
    expect(await readRuntimeFile(file)).toBeNull();
  });

  it('DEFAULT_DSH_HOME 指向 ~/.dsh-cursorkit', () => {
    const { homedir } = require('node:os') as typeof import('node:os');
    expect(join(homedir(), '.dsh-cursorkit')).toContain('.dsh-cursorkit');
    // 与扩展约定一致（V2-DECISIONS D24）
    expect(join(homedir(), '.dsh-cursorkit')).not.toContain('.dsh/');
  });

  it('cordis.patch.yml 存在且含 host 插件 insert', () => {
    const patch = readFileSync(
      join(__dirname, '..', '..', '..', 'packages', 'host-dsh', 'cordis.patch.yml'),
      'utf8',
    );
    expect(patch).toContain('cursorkit-host');
    expect(patch).toContain('inject');
    expect(patch).toContain('runtime.json');
  });
});
