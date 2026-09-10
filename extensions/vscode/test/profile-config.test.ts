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
  profileDir,
  DEFAULT_DSH_HOME,
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
