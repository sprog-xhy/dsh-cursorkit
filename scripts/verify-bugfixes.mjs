/**
 * 缺陷修复的协议层验证（真实 dsh sidecar）。
 *
 * 验证本轮修复所依赖的假设：
 * 1. session.get 返回 lastSeq（用于切换会话/补全的游标订阅）
 * 2. session.get 是否返回 model（决定"切换来的会话模型未知"这一退化是否正确）
 * 3. model.list 的 provider 字段（决定 fullModelName 拼装是否正确）
 * 4. session.list 条目结构（会话面板）
 * 5. git show HEAD:<rel> 可用（审查 diff 的左侧内容来源）
 *
 * 用法：node scripts/verify-bugfixes.mjs
 */
import { spawn, execFile } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const DSH_HOME = process.env.CK_DSH_HOME ?? join(homedir(), '.dsh-cursorkit');
const WORKSPACE = process.cwd();
const runtimeFile = join(DSH_HOME, '.cursorkit', 'runtime.json');
const MODEL = 'wps/moonshot/kimi-k2.7-code';

const log = (m) => console.log(`[verify-fix] ${m}`);
const ok = (m) => console.log(`[verify-fix] ✅ ${m}`);
const bad = (m) => {
  console.error(`[verify-fix] ❌ ${m}`);
  process.exitCode = 1;
};

let proc = null;

/** 用扩展的同一实现同步 profile 依赖（缺快照/源码变化时安装）。 */
async function syncDeps() {
  const { execFileSync } = await import('node:child_process');
  const repo = process.cwd();
  const dir = join(DSH_HOME, 'profiles', 'cursorkit');
  const bundled = '/tmp/ck-profile-config.mjs';
  const esbuildBin = join(repo, 'extensions/vscode/node_modules/.bin/esbuild');
  execFileSync(
    esbuildBin,
    [
      join(repo, 'extensions/vscode/src/profile-config.ts'),
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--outfile=${bundled}`,
      '--log-level=error',
    ],
    { cwd: repo, stdio: 'pipe' },
  );
  const mod = await import(bundled);
  const res = await mod.syncProfileDeps({
    dir,
    hostDir: join(repo, 'packages', 'host-dsh'),
    protocolDir: join(repo, 'packages', 'protocol'),
    log: (m) => log(`[deps] ${m}`),
  });
  if (res.installed) ok('profile 依赖已同步安装（此前缺失或源码已更新）');
}

async function boot() {
  try {
    const old = JSON.parse(readFileSync(runtimeFile, 'utf8'));
    try {
      process.kill(old.pid, 0);
      log(`复用已有 sidecar pid=${old.pid}`);
      return;
    } catch {
      rmSync(runtimeFile, { force: true });
    }
  } catch {
    /* 无残留 */
  }
  proc = spawn('dsh', ['--profile', 'cursorkit'], {
    env: { ...process.env, DSH_HOME, DSH_PERMISSION_MODE: 'danger-full-access' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr?.on('data', (d) => {
    const s = String(d).trim();
    if (s) log(`[dsh:err] ${s.slice(0, 200)}`);
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const info = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      if (info.port) {
        try {
          process.kill(info.pid, 0);
          log(`sidecar ready pid=${info.pid} port=${info.port}`);
          return;
        } catch {
          /* wait */
        }
      }
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('sidecar 启动超时');
}

async function main() {
  await syncDeps();
  await boot();
  const info = JSON.parse(readFileSync(runtimeFile, 'utf8'));
  const base = `http://127.0.0.1:${info.port}`;
  const headers = { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' };
  const call = async (method, params) => {
    const res = await fetch(`${base}/v1/rpc/${method}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: `r-${Date.now()}`, method, params }),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  };

  // 1. session.get → lastSeq / model
  const s1 = await call('session.create', { workspace: WORKSPACE, model: MODEL });
  const detail = await call('session.get', { id: s1.id });
  if (typeof detail.lastSeq === 'number') ok(`session.get 返回 lastSeq=${detail.lastSeq}（游标订阅可用）`);
  else bad('session.get 缺少 lastSeq（切换会话的游标订阅会退化）');
  if ('model' in detail) ok(`session.get 含 model 字段：${detail.model}（可精确跟踪模型）`);
  else log('note: session.get 不含 model 字段 → 切换来的会话只能标为「模型未知」（已按此退化实现）');

  // 2. session.list 结构（会话面板）
  const list = await call('session.list', {});
  const entry = list.find((x) => x.id === s1.id);
  if (entry && typeof entry.workspace === 'string') ok(`session.list 条目含 workspace（面板显示：${entry.workspace.split('/').pop()}）`);
  else bad('session.list 条目缺少 workspace');

  // 3. model.list → provider（fullModelName 依赖）
  const models = await call('model.list', {});
  const withProvider = models.filter((m) => typeof m.provider === 'string' && m.provider);
  if (models.length > 0 && withProvider.length === models.length) {
    const sample = withProvider[0];
    ok(`model.list ${models.length} 项均带 provider → 拼装为 "${sample.provider}/${sample.id}"`);
  } else {
    bad(`model.list 有 ${models.length - withProvider.length} 项缺 provider（模型拼装会退化）`);
  }
  const providers = [...new Set(models.map((m) => m.provider))];
  if (providers.length > 1) {
    log(`note: 存在多个 provider（${providers.join(', ')}）→ 原先硬编码 wps/ 会拼错，已验证修复必要性`);
  }

  // 4. git show HEAD:<rel>（审查 diff 左侧来源）
  try {
    const { stdout } = await exec('git', ['show', 'HEAD:README.md'], { cwd: WORKSPACE, encoding: 'utf8' });
    if (stdout.includes('dsh-cursorkit')) ok('git show HEAD:<rel> 可用（审查 diff 左侧内容来源成立）');
    else bad('git show 输出异常');
  } catch (err) {
    bad(`git show HEAD:<rel> 失败：${err.message}`);
  }

  // 5. 会话模型持久化（重启后仍可回读）
  try {
    const f = join(DSH_HOME, '.cursorkit', 'session-index.json');
    // 落盘有防抖（400ms）→ 轮询到内容包含本次会话（最多 4s）
    const readIndex = () => {
      try {
        return JSON.parse(readFileSync(f, 'utf8'));
      } catch {
        return null;
      }
    };
    for (let i = 0; i < 20; i++) {
      const idx = readIndex();
      if (idx && idx[s1.id]) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const idx = readIndex();
    if (idx?.[s1.id]?.model === MODEL) {
      ok(`session-index.json 已落盘（${s1.id} → ${idx[s1.id].model} @ ${idx[s1.id].workspace}）`);
    } else if (idx?.[s1.id]) {
      bad(`索引里模型不正确：${JSON.stringify(idx[s1.id])}`);
    } else {
      bad('未生成 session-index.json（重启后历史会话会消失）');
    }
  } catch (err) {
    bad(`session-models 检查失败：${err.message}`);
  }

  // 6. diff.get（审查面板数据源）
  try {
    const changes = await call('diff.get', { sessionId: s1.id });
    ok(`diff.get 可用（返回 ${Array.isArray(changes) ? changes.length : '?'} 条改动）`);
  } catch (err) {
    log(`note: diff.get 当前返回：${err.message.slice(0, 80)}`);
  }

  // 7. 重启后模型回读（遗留项：内存映射重启即丢）
  try {
    const oldPid = info.pid;
    try {
      process.kill(oldPid, 'SIGTERM');
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 1200));
    rmSync(runtimeFile, { force: true });
    log('已结束旧 sidecar，重新启动以验证模型持久化…');
    proc = null;
    await boot();
    const info2 = JSON.parse(readFileSync(runtimeFile, 'utf8'));
    const base2 = `http://127.0.0.1:${info2.port}`;
    const headers2 = { authorization: `Bearer ${info2.token}`, 'content-type': 'application/json' };
    const res = await fetch(`${base2}/v1/rpc/session.get`, {
      method: 'POST',
      headers: headers2,
      body: JSON.stringify({ id: 'r-restart', method: 'session.get', params: { id: s1.id } }),
    });
    const body = await res.json();
    if (!body.ok) {
      bad(`重启后 session.get 失败：${JSON.stringify(body.error)}`);
    } else if (body.result.model === MODEL) {
      ok(`重启后仍能回读历史会话：${s1.id} → ${body.result.model}`);
    } else {
      bad(`重启后模型丢失（model=${String(body.result.model)}）→ 会退化为「模型未知」`);
    }

    // 重启后历史会话应出现在列表里（此前为空）
    const listRes = await fetch(`${base2}/v1/rpc/session.list`, {
      method: 'POST',
      headers: headers2,
      body: JSON.stringify({ id: 'r-restart-list', method: 'session.list', params: {} }),
    });
    const listBody = await listRes.json();
    const ids = listBody.ok ? listBody.result.map((x) => x.id) : [];
    if (ids.includes(s1.id)) ok(`重启后 session.list 仍列出历史会话（共 ${ids.length} 条）`);
    else bad('重启后 session.list 未列出历史会话（前端会显示为空）');
  } catch (err) {
    bad(`重启验证失败：${err.message}`);
  }

  log('协议层验证完成');
}

main()
  .catch((err) => {
    bad(err.message);
  })
  .finally(() => {
    if (proc) proc.kill('SIGTERM');
  });
