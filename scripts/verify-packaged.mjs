/**
 * 安装形态验证：解压 vsix，只用包内自带依赖（bundled/）建 profile 并启动 sidecar。
 *
 * 目的：证明"装 vsix 就能用"——不依赖用户机器上有仓库源码。
 * （历史缺陷：扩展用 resolve(__dirname,'..','..','..') 找仓库 packages/，
 *  安装后解析成 ~/.vscode，导致 sidecar 永久启动失败。）
 *
 * 用法：node scripts/verify-packaged.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, copyFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const REPO = process.cwd();
const VSIX = join(REPO, 'extensions/vscode/dsh-cursorkit-0.1.0.vsix');
const SOURCE_HOME = process.env.CK_DSH_HOME ?? join(homedir(), '.dsh-cursorkit');

const log = (m) => console.log(`[verify-packaged] ${m}`);
const ok = (m) => console.log(`[verify-packaged] ✅ ${m}`);
const bad = (m) => {
  console.error(`[verify-packaged] ❌ ${m}`);
  process.exitCode = 1;
};

async function main() {
  if (!existsSync(VSIX)) throw new Error(`未找到 vsix：${VSIX}（先运行 pnpm package）`);

  // 1. 解压 vsix（等价于安装后的扩展目录）
  const root = mkdtempSync(join(tmpdir(), 'ck-vsix-'));
  // vsix 内部顶层就是 extension/，解压到 root 后扩展目录是 root/extension
  execFileSync('python3', ['-m', 'zipfile', '-e', VSIX, root], { stdio: 'pipe' });
  const extDir = join(root, 'extension');
  log(`解压到 ${extDir}`);

  const hostDir = join(extDir, 'bundled', 'host-dsh');
  const protocolDir = join(extDir, 'bundled', 'protocol');
  for (const [name, p] of [
    ['host-dsh/lib/index.js', join(hostDir, 'lib', 'index.js')],
    ['host-dsh/cordis.patch.yml', join(hostDir, 'cordis.patch.yml')],
    ['protocol/lib/index.js', join(protocolDir, 'lib', 'index.js')],
  ]) {
    if (existsSync(p)) ok(`包内自带 ${name}`);
    else bad(`包内缺少 ${name} —— 安装形态不可用`);
  }
  if (process.exitCode) return;

  // 2. 全新 DSH_HOME（只放 provider 配置）
  const home = join(root, 'dsh-home');
  mkdirSync(join(home, '.cursorkit'), { recursive: true });
  for (const f of ['settings.yaml', '.credentials.yaml']) {
    const src = join(SOURCE_HOME, f);
    if (existsSync(src)) copyFileSync(src, join(home, f));
  }

  // 3. 用包内依赖生成 profile（与扩展同一实现）
  const bundledCfg = join(root, 'profile-config.mjs');
  execFileSync(
    join(REPO, 'extensions/vscode/node_modules/.bin/esbuild'),
    [
      join(REPO, 'extensions/vscode/src/profile-config.ts'),
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--outfile=${bundledCfg}`,
      '--log-level=error',
    ],
    { stdio: 'pipe' },
  );
  const mod = await import(bundledCfg);
  const dir = mod.profileDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), mod.buildProfilePackage(hostDir, protocolDir));
  writeFileSync(join(dir, 'cordis.patch.yml'), mod.buildProfilePatch());
  const res = await mod.syncProfileDeps({ dir, hostDir, protocolDir, log: (m) => log(`[deps] ${m}`) });
  if (res.installed) ok('用包内依赖完成 profile 安装');
  const installedPkg = join(dir, 'node_modules', '@dsh-cursorkit', 'host-dsh', 'lib', 'index.js');
  if (existsSync(installedPkg)) ok('profile 内 host-dsh 就位');
  else bad('profile 内 host-dsh 缺失');

  // 4. 启动 sidecar（真实 dsh）
  const runtimeFile = join(home, '.cursorkit', 'runtime.json');
  const proc = spawn('dsh', ['--profile', 'cursorkit'], {
    env: { ...process.env, DSH_HOME: home, DSH_PERMISSION_MODE: 'danger-full-access' },
    stdio: 'ignore',
  });
  proc.on('error', (err) => bad(`spawn 失败：${err.message}`));
  let info = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const raw = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      if (raw.port) {
        info = raw;
        break;
      }
    } catch {
      /* wait */
    }
  }
  if (!info) {
    bad('安装形态 sidecar 启动失败（30s 无 runtime.json）');
    return;
  }
  ok(`sidecar 启动成功（pid=${info.pid} port=${info.port} dsh=${info.dshVersion}）`);

  // 5. 真实调用一次（capability + 建会话）——证明插件完整加载
  const headers = { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' };
  const caps = await (await fetch(`http://127.0.0.1:${info.port}/v1/capabilities`, { headers })).json();
  if (caps?.required?.ok) ok('capability 探测通过（host 插件已加载）');
  else bad(`capability 异常：${JSON.stringify(caps).slice(0, 120)}`);

  const createRes = await fetch(`http://127.0.0.1:${info.port}/v1/rpc/session.create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: 'r1',
      method: 'session.create',
      params: { workspace: REPO, model: 'wps/moonshot/kimi-k2.7-code' },
    }),
  });
  const created = await createRes.json();
  if (created.ok) ok(`安装形态可正常建会话（${created.result.id}）`);
  else bad(`建会话失败：${JSON.stringify(created.error)}`);

  // 6. 历史方法存在（本轮新增）
  const histRes = await fetch(`http://127.0.0.1:${info.port}/v1/rpc/session.history`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: 'r2', method: 'session.history', params: { id: created.result.id } }),
  });
  const hist = await histRes.json();
  if (hist.ok) ok(`session.history 可用（${hist.result.events.length} 个事件）`);
  else bad(`session.history 不可用：${JSON.stringify(hist.error)}`);

  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    /* ignore */
  }
  rmSync(root, { recursive: true, force: true });
  log('安装形态验证完成');
}

main().catch((err) => bad(err.message));
