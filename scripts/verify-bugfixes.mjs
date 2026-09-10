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
import { readFileSync, rmSync } from 'node:fs';
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

  // 5. diff.get（审查面板数据源）
  try {
    const changes = await call('diff.get', { sessionId: s1.id });
    ok(`diff.get 可用（返回 ${Array.isArray(changes) ? changes.length : '?'} 条改动）`);
  } catch (err) {
    log(`note: diff.get 当前返回：${err.message.slice(0, 80)}`);
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
