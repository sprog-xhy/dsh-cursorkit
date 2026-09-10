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
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

/** 依赖安装指纹文件（放在 profile 目录内）。 */
export const INSTALL_STAMP = '.cursorkit-install-stamp';

/** profile 内已安装依赖的探测路径（相对 profile 目录）。 */
export const INSTALLED_HOST_REL = join('node_modules', '@dsh-cursorkit', 'host-dsh', 'package.json');

/**
 * 是否需要（重新）安装 profile 依赖。
 *
 * 背景：pnpm 的 `file:` 依赖是**快照**（复制进 .pnpm store），
 * host-dsh 源码/构建产物变化后 profile 内的副本不会自动更新；
 * 而 dsh 是从 profile 目录解析插件名的，缺副本/副本过期都会导致 sidecar 启动失败。
 */
export function installNeeded(opts: {
  /** 已写入的指纹（无则 null）。 */
  stamp: string | null;
  /** 当前源码指纹。 */
  fingerprint: string;
  /** profile 内是否已存在 host-dsh 安装副本。 */
  hasInstalledPackage: boolean;
}): boolean {
  if (!opts.hasInstalledPackage) return true;
  return opts.stamp !== opts.fingerprint;
}

/** 由文件清单（名/大小/mtime）计算稳定指纹。 */
export function fingerprintOf(entries: { name: string; size: number; mtimeMs: number }[]): string {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const payload = sorted.map((e) => `${e.name}:${e.size}:${Math.floor(e.mtimeMs)}`).join('|');
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = ((h2 + c) * 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

/** profile 依赖安装命令（优先 pnpm，交给调用方决定回退 npm）。 */
export function installCommand(): { bin: string; args: string[] } {
  return { bin: 'pnpm', args: ['install', '--prefer-offline', '--no-frozen-lockfile'] };
}

/** 计算 host-dsh 源码/构建产物指纹（package.json + cordis.patch.yml + lib/*.js）。 */
export async function computeHostFingerprint(hostDir: string): Promise<string> {
  const entries: { name: string; size: number; mtimeMs: number }[] = [];
  const push = async (p: string, name: string): Promise<void> => {
    try {
      const st = await stat(p);
      entries.push({ name, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      /* 不存在则跳过 */
    }
  };
  await push(join(hostDir, 'package.json'), 'package.json');
  await push(join(hostDir, PATCH_FILENAME), PATCH_FILENAME);
  try {
    for (const f of await readdir(join(hostDir, 'lib'))) {
      if (f.endsWith('.js')) await push(join(hostDir, 'lib', f), `lib/${f}`);
    }
  } catch {
    /* 未构建：仅 package.json 参与 */
  }
  if (entries.length === 0) throw new Error(`host-dsh 目录不可读：${hostDir}`);
  return fingerprintOf(entries);
}

export interface SyncProfileDepsResult {
  /** 是否执行了安装。 */
  installed: boolean;
  /** 指纹。 */
  fingerprint: string;
}

/**
 * 同步 profile 依赖：缺失或源码变化时执行安装（幂等）。
 *
 * 这是 sidecar 能启动的前提：dsh 从 profile 目录解析 `@dsh-cursorkit/host-dsh`，
 * 而 pnpm 的 file: 依赖是快照，源码/构建更新后必须重装。
 * 扩展与验证脚本共用本函数，行为一致。
 */
export async function syncProfileDeps(opts: {
  dir: string;
  hostDir: string;
  log?: (msg: string) => void;
  timeoutMs?: number;
}): Promise<SyncProfileDepsResult> {
  const { dir, hostDir, log = () => undefined, timeoutMs = 180_000 } = opts;
  const installedPkg = join(dir, INSTALLED_HOST_REL);
  const stampFile = join(dir, INSTALL_STAMP);
  const fingerprint = await computeHostFingerprint(hostDir);
  let stamp: string | null = null;
  try {
    stamp = readFileSync(stampFile, 'utf8').trim();
  } catch {
    stamp = null;
  }
  if (!installNeeded({ stamp, fingerprint, hasInstalledPackage: existsSync(installedPkg) })) {
    return { installed: false, fingerprint };
  }

  log('安装 profile 依赖（pnpm file: 快照需与源码同步）…');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const { bin, args } = installCommand();
  try {
    const { stdout } = await execFileAsync(bin, args, { cwd: dir, timeout: timeoutMs, maxBuffer: 8 << 20 });
    log(`[install] ${stdout.trim().split('\n').slice(-2).join(' | ')}`);
  } catch (err) {
    log(`pnpm 安装失败，回退 npm：${(err as Error).message}`);
    try {
      await execFileAsync('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: dir,
        timeout: timeoutMs,
        maxBuffer: 8 << 20,
      });
    } catch (err2) {
      throw new Error(
        `profile 依赖安装失败（${(err2 as Error).message}）。请手动执行：cd ${dir} && pnpm install`,
      );
    }
  }
  if (!existsSync(installedPkg)) {
    throw new Error(`安装后仍找不到 ${installedPkg}，请检查 profile 的 dependencies 配置`);
  }
  try {
    await writeFile(stampFile, `${fingerprint}\n`, { mode: 0o600 });
  } catch {
    /* 指纹写失败只是下次会重装 */
  }
  return { installed: true, fingerprint };
}
