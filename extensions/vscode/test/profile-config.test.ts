/**
 * profile 配置生成测试。
 * 覆盖历史缺陷：生成的 patch 曾 insert agent-loop（与 dsh-base 冲突导致启动失败）
 * 且缺少必需的 cursorkit-host。
 */
import { describe, it, expect } from 'vitest';
import {
  buildProfilePatch,
  buildProfilePackage,
  profilePatchNeedsRepair,
  profilePackageNeedsRepair,
  profileDir,
  DEFAULT_DSH_HOME,
  INSTALLED_HOST_REL,
  installCommand,
  installNeeded,
  fingerprintOf,
} from '../src/profile-config.ts';

describe('buildProfilePatch', () => {
  const patch = buildProfilePatch();

  it('insert cursorkit-host（CKP server 必需）', () => {
    expect(patch).toContain('id: cursorkit-host');
    expect(patch).toContain("name: '@dsh-cursorkit/host-dsh'");
    expect(patch).toContain('inject: [sessions, agents, agentLoop, approval]');
    expect(patch).toContain("tokenFile: '$DSH_HOME/.cursorkit/runtime.json'");
  });

  it('不在 insert 块里 insert agent-loop（会导致 duplicate 启动失败）', () => {
    expect(profilePatchNeedsRepair(patch)).toBe(false);
    const rest = patch.slice(patch.indexOf('- insert:') + '- insert:'.length);
    const next = /\n-(?=\s|$)/.exec(rest);
    const insertBlock = next ? rest.slice(0, next.index) : rest;
    expect(insertBlock).not.toContain('agent-loop');
  });

  it('agent-loop 用顶层覆盖写法（出现在 insert 块之后）', () => {
    expect(patch).toMatch(/\n- id: agent-loop\n/);
  });
});

describe('profilePatchNeedsRepair', () => {
  it('缺少 cursorkit-host → 需要修复（换机器时的历史 landmine）', () => {
    expect(profilePatchNeedsRepair('- insert:\n    - id: agent-loop\n')).toBe(true);
  });

  it('insert 块里出现 agent-loop → 需要修复', () => {
    const broken = [
      '- insert:',
      '    - id: cursorkit-host',
      "      name: '@dsh-cursorkit/host-dsh'",
      '    - id: agent-loop',
      "      name: '@deepseek-ai/dsh-agent-loop'",
      '',
    ].join('\n');
    expect(profilePatchNeedsRepair(broken)).toBe(true);
  });

  it('已正确的 patch → 不需要修复（幂等）', () => {
    expect(profilePatchNeedsRepair(buildProfilePatch())).toBe(false);
    const working = [
      '- insert:',
      '    - id: cursorkit-host',
      "      name: '@dsh-cursorkit/host-dsh'",
      '      config:',
      '        port: 0',
      "        tokenFile: '$DSH_HOME/.cursorkit/runtime.json'",
      '- id: agent-loop',
      '  config:',
      '    agents: []',
      '',
    ].join('\n');
    expect(profilePatchNeedsRepair(working)).toBe(false);
  });

  it('空 patch → 需要修复', () => {
    expect(profilePatchNeedsRepair('[]')).toBe(true);
  });
});

describe('buildProfilePackage / profileDir', () => {
  it('声明 dsh-base bundle 与 file: 依赖', () => {
    const pkg = JSON.parse(buildProfilePackage('/repo/packages/host-dsh', '/repo/packages/protocol'));
    expect(pkg.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base']);
    expect(pkg.dependencies['@dsh-cursorkit/host-dsh']).toBe('file:/repo/packages/host-dsh');
    expect(pkg.dependencies['@dsh-cursorkit/protocol']).toBe('file:/repo/packages/protocol');
  });

  it('profile 目录位于 DSH_HOME/profiles/cursorkit', () => {
    expect(profileDir('/home/u/.dsh-cursorkit')).toBe('/home/u/.dsh-cursorkit/profiles/cursorkit');
  });

  it('默认 DSH_HOME 是独立目录（不污染 ~/.dsh）', () => {
    expect(DEFAULT_DSH_HOME).toContain('.dsh-cursorkit');
    expect(DEFAULT_DSH_HOME.endsWith('/.dsh')).toBe(false);
  });
});

describe('installNeeded / fingerprintOf（P0：profile 依赖快照过期）', () => {
  it('未安装过 → 需要安装', () => {
    expect(installNeeded({ stamp: null, fingerprint: 'a', hasInstalledPackage: false })).toBe(true);
  });

  it('已安装但指纹不同（源码/构建更新）→ 需要重装', () => {
    expect(installNeeded({ stamp: 'old', fingerprint: 'new', hasInstalledPackage: true })).toBe(true);
  });

  it('已安装且指纹一致 → 跳过（避免每次启动都装）', () => {
    expect(installNeeded({ stamp: 'same', fingerprint: 'same', hasInstalledPackage: true })).toBe(false);
  });

  it('无指纹文件但已安装 → 重装一次以建立指纹', () => {
    expect(installNeeded({ stamp: null, fingerprint: 'x', hasInstalledPackage: true })).toBe(true);
  });

  it('指纹对文件顺序不敏感，对内容变化敏感', () => {
    const a = { name: 'lib/a.js', size: 10, mtimeMs: 1000 };
    const b = { name: 'lib/b.js', size: 20, mtimeMs: 2000 };
    expect(fingerprintOf([a, b])).toBe(fingerprintOf([b, a]));
    expect(fingerprintOf([a, b])).not.toBe(fingerprintOf([a, { ...b, size: 999 }]));
    expect(fingerprintOf([a, b])).not.toBe(fingerprintOf([a, { ...b, mtimeMs: 999999 }]));
  });

  it('安装命令为 pnpm install（dsh 生态一致）', () => {
    const cmd = installCommand();
    expect(cmd.bin).toBe('pnpm');
    expect(cmd.args).toContain('install');
  });

  it('INSTALLED_HOST_REL 指向 profile 内 host-dsh 的 package.json', () => {
    expect(INSTALLED_HOST_REL).toContain('node_modules');
    expect(INSTALLED_HOST_REL.endsWith('host-dsh/package.json')).toBe(true);
  });
});

describe('profilePackageNeedsRepair（依赖路径变化）', () => {
  const HOST = '/opt/ext/bundled/host-dsh';
  const PROTO = '/opt/ext/bundled/protocol';
  const good = JSON.stringify({
    name: 'dsh-profile-cursorkit',
    dependencies: {
      '@dsh-cursorkit/host-dsh': `file:${HOST}`,
      '@dsh-cursorkit/protocol': `file:${PROTO}`,
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  });

  it('路径与 bundle 均正确 → 不需重写', () => {
    expect(profilePackageNeedsRepair(good, HOST, PROTO)).toBe(false);
  });

  it('指向仓库旧路径（先 F5 后装 vsix）→ 需重写', () => {
    const stale = good.replace(`file:${HOST}`, 'file:/home/u/repo/packages/host-dsh');
    expect(profilePackageNeedsRepair(stale, HOST, PROTO)).toBe(true);
  });

  it('缺少 bundles 声明 → 需重写', () => {
    const noBundles = JSON.stringify({ dependencies: JSON.parse(good).dependencies });
    expect(profilePackageNeedsRepair(noBundles, HOST, PROTO)).toBe(true);
  });

  it('JSON 损坏 → 需重写', () => {
    expect(profilePackageNeedsRepair('{bad', HOST, PROTO)).toBe(true);
  });
});
