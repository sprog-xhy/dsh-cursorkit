/**
 * dsh profile 配置生成（纯逻辑，无 vscode 依赖 → 可单测）。
 *
 * 背景（早期实测结论，勿改）：
 * - **dsh-base 已内置 agent-loop**：再 `insert` 一个会 `duplicate loader entry id: agent-loop`，
 *   sidecar 直接启动失败。需要改配置时只能用【顶层覆盖】（`- id: agent-loop`）。
 * - **cursorkit-host 必须在 profile 层 patch 里 insert**：host-dsh 包内自带的
 *   cordis.patch.yml 不会被自动加载（实测：只靠包内 patch 时 runtime.json 永不出现）。
 *
 * 历史缺陷：旧实现生成的 patch 恰好与此相反（insert agent-loop、缺 cursorkit-host），
 * 只在"已经手工写好 profile"的机器上侥幸可用；换机器/新建 profile 时 sidecar 启动失败。
 */
import { join } from 'node:path';
import { homedir } from 'node:os';

/** profile 名（`dsh --profile cursorkit`）。 */
export const PROFILE_NAME = 'cursorkit';

/** 默认 DSH_HOME（独立数据目录，绝不继承 ambient DSH_HOME）。 */
export const DEFAULT_DSH_HOME = join(homedir(), '.dsh-cursorkit');

/** profile 内 patch 文件相对路径。 */
export const PATCH_FILENAME = 'cordis.patch.yml';

/** runtime.json 相对 DSH_HOME 的路径。 */
export const RUNTIME_RELATIVE = join('.cursorkit', 'runtime.json');

/** profile 目录。 */
export function profileDir(dshHome: string): string {
  return join(dshHome, 'profiles', PROFILE_NAME);
}

/**
 * 生成 profile 层 cordis.patch.yml（已实测可启动的形态）。
 * - insert cursorkit-host（必需：CKP server + approval/checkpoint/worktree/diff）
 * - 顶层覆盖 agent-loop 配置（不可 insert，dsh-base 已内置）
 */
export function buildProfilePatch(): string {
  return [
    '# dsh-cursorkit profile patch overlay (auto-generated)',
    '# - cursorkit-host：CKP server 插件（必需；包内自带 patch 不会被自动加载）',
    '# - agent-loop：顶层「覆盖」写法（dsh-base 已内置该 id，insert 会 duplicate 导致启动失败）',
    '- insert:',
    '    - id: cursorkit-host',
    "      name: '@dsh-cursorkit/host-dsh'",
    '      inject: [sessions, agents, agentLoop, approval]',
    '      config:',
    '        port: 0',
    "        tokenFile: '$DSH_HOME/.cursorkit/runtime.json'",
    '- id: agent-loop',
    '  config:',
    '    agents: []',
    '',
  ].join('\n');
}

/** 生成 profile 的 package.json（bundle + host-dsh/protocol 的 file: 依赖）。 */
export function buildProfilePackage(hostPath: string, protocolPath: string): string {
  return `${JSON.stringify(
    {
      name: 'dsh-profile-cursorkit',
      private: true,
      dependencies: {
        '@dsh-cursorkit/host-dsh': `file:${hostPath}`,
        '@dsh-cursorkit/protocol': `file:${protocolPath}`,
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    },
    null,
    2,
  )}\n`;
}

/**
 * 已有 patch 是否需要修复。
 * 判据：必须 insert cursorkit-host，且**不能**在 insert 块里 insert agent-loop。
 */
export function profilePatchNeedsRepair(existing: string): boolean {
  if (!existing.includes('cursorkit-host')) return true;
  const marker = '- insert:';
  const at = existing.indexOf(marker);
  if (at === -1) return true;
  const rest = existing.slice(at + marker.length);
  // insert 块内容 = 从该行之后到下一个【顶层条目】（列 0 起头的 "- "）为止
  const next = /\n-(?=\s|$)/.exec(rest);
  const block = next ? rest.slice(0, next.index) : rest;
  return block.includes('agent-loop');
}
