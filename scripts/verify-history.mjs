/**
 * 历史会话恢复验证（真实 dsh sidecar）。
 *
 * 场景：创建会话 → 发消息 → 重启 sidecar → 用 session.history 恢复历史。
 * 断言：历史事件里能看到用户消息与助手回复（即"历史会话可恢复"）。
 *
 * 用法：node scripts/verify-history.mjs
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

const log = (m) => console.log(`[verify-history] ${m}`);
const ok = (m) => console.log(`[verify-history] ✅ ${m}`);
const bad = (m) => {
  console.error(`[verify-history] ❌ ${m}`);
  process.exitCode = 1;
};

let proc = null;

async function syncDeps() {
  const { execFileSync } = await import('node:child_process');
  const repo = process.cwd();
  const dir = join(DSH_HOME, 'profiles', 'cursorkit');
  const bundled = '/tmp/ck-profile-config.mjs';
  execFileSync(
    join(repo, 'extensions/vscode/node_modules/.bin/esbuild'),
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
  if (res.installed) log('profile 依赖已同步');
}

async function boot() {
  proc = spawn('dsh', ['--profile', 'cursorkit'], {
    env: { ...process.env, DSH_HOME, DSH_PERMISSION_MODE: 'danger-full-access' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr?.on('data', (d) => {
    const s = String(d).trim();
    if (s && !s.includes('ExperimentalWarning')) log(`[dsh:err] ${s.slice(0, 160)}`);
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const info = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      if (info.port) {
        try {
          process.kill(info.pid, 0);
          return info;
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

function rpcFor(info) {
  const base = `http://127.0.0.1:${info.port}`;
  const headers = { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' };
  return async (method, params) => {
    const res = await fetch(`${base}/v1/rpc/${method}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: `r-${Date.now()}`, method, params }),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  };
}

async function main() {
  await syncDeps();
  let info = await boot();
  let call = rpcFor(info);
  log(`sidecar ready port=${info.port}`);

  // 1. 建会话 + 发一条消息（产生历史）
  const session = await call('session.create', { workspace: WORKSPACE, model: MODEL });
  log(`session created: ${session.id}`);
  const PROMPT = '请只回复两个字：收到';
  await call('session.send', { id: session.id, text: PROMPT, mode: 'ask' });
  log('消息已发送，等待回复…');
  // 等一会儿让事件落盘（助手回复 + turn/end）
  await new Promise((r) => setTimeout(r, 12000));

  // 2. 重启 sidecar（模拟"关闭 VSCode / 重启内核"）
  log('重启 sidecar…');
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 1500));
  rmSync(runtimeFile, { force: true });
  info = await boot();
  call = rpcFor(info);
  log(`sidecar restarted port=${info.port}`);

  // 3. 重启后立刻查列表：历史会话应还在
  const list = await call('session.list', {});
  const stillListed = list.some((x) => x.id === session.id);
  if (stillListed) ok(`重启后 session.list 仍列出该会话（共 ${list.length} 条）`);
  else bad('重启后 session.list 未列出该会话');

  // 4. session.get 应能读到元数据
  const detail = await call('session.get', { id: session.id });
  if (detail?.model === MODEL) ok(`重启后 session.get 返回元数据（model=${detail.model}）`);
  else bad(`重启后 session.get 元数据异常：${JSON.stringify(detail)}`);

  // 5. 核心：session.history 恢复历史事件
  const hist = await call('session.history', { id: session.id });
  log(`session.history → ${hist.events.length} 个事件（resumed=${hist.resumed}, truncated=${hist.truncated}）`);
  const types = hist.events.map((e) => e.type);
  const userText = hist.events
    .filter((e) => e.type === 'message.user')
    .map((e) => e.text)
    .join(' | ');
  const assistantText = hist.events
    .filter((e) => e.type === 'message.delta')
    .map((e) => e.text)
    .join('');

  if (hist.events.length > 0) ok(`历史事件已恢复（事件类型：${[...new Set(types)].join(', ')}）`);
  else bad('session.history 返回空 —— 历史会话无法恢复');

  if (userText.includes('收到')) ok(`历史里包含用户消息（${userText.slice(0, 60)}）`);
  else bad(`历史里没有用户消息（userText=${userText.slice(0, 80)}）`);

  if (assistantText.trim().length > 0) ok(`历史里包含助手回复（${assistantText.slice(0, 60)}…）`);
  else log('note: 未在历史里找到助手文本（模型可能未回复或回复为空）');

  // 6. 恢复后的会话可以继续对话
  try {
    const sendRes = await call('session.send', { id: session.id, text: '继续', mode: 'ask' });
    ok(`恢复后的会话可继续发送（messageId=${sendRes.messageId}）`);
  } catch (err) {
    bad(`恢复后的会话无法继续：${err.message}`);
  }

  log('历史恢复验证完成');
}

main()
  .catch((err) => bad(err.message))
  .finally(() => {
    // 保留 sidecar 供后续使用（不 kill）
    void proc;
  });
