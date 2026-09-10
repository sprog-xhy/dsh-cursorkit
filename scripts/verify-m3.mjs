/**
 * M3 能力验证：model.list（真实 settings）+ session.create/send 全链路。
 * 用法：node scripts/verify-m3.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DSH_HOME = process.env.CK_DSH_HOME ?? join(homedir(), '.dsh-cursorkit');
const runtimeFile = join(DSH_HOME, '.cursorkit', 'runtime.json');
const log = (m) => console.log(`[verify-m3] ${m}`);

// 清理残留
try {
  const old = JSON.parse(readFileSync(runtimeFile, 'utf8'));
  try { process.kill(old.pid, 0); log(`复用 sidecar pid=${old.pid}`); }
  catch { rmSync(runtimeFile, { force: true }); }
} catch { /* noop */ }

const proc = spawn('dsh', ['--profile', 'cursorkit'], {
  env: { ...process.env, DSH_HOME, DSH_PERMISSION_MODE: 'danger-full-access' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stderr?.on('data', (d) => log(`[dsh:err] ${String(d).trimEnd()}`));

async function waitRuntime(ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const info = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      if (info.port && info.token) { try { process.kill(info.pid, 0); return info; } catch {} }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('sidecar 启动超时');
}

async function main() {
  const info = await waitRuntime();
  log(`sidecar ready dsh=${info.dshVersion} port=${info.port}`);
  const base = `http://127.0.0.1:${info.port}`;
  const headers = { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' };
  const call = async (m, p) => {
    const res = await fetch(`${base}/v1/rpc/${m}`, { method: 'POST', headers, body: JSON.stringify({ id: `r-${Date.now()}`, method: m, params: p }) });
    const body = await res.json();
    if (!body.ok) throw new Error(`${m}: ${JSON.stringify(body.error)}`);
    return body.result;
  };

  // 1. model.list（真实 settings）
  const models = await call('model.list', {});
  log(`model.list → ${models.length} 个模型`);
  if (models.length === 0) throw new Error('model.list 为空（settings 解析失败）');
  const wpsModels = models.filter((m) => m.provider === 'wps');
  log(`wps 模型 ${wpsModels.length} 个: ${wpsModels.slice(0, 3).map((m) => m.id).join(', ')}…`);

  // 2. 会话 + 消息全链路
  const s = await call('session.create', { workspace: process.cwd(), model: 'wps/moonshot/kimi-k2.7-code' });
  log(`session created: ${s.id}`);
  const res = await call('session.send', { id: s.id, text: '你好', mode: 'ask' });
  log(`message sent: ${res.messageId}`);

  // 3. checkpoint 能力探测
  const caps = await (await fetch(`${base}/v1/capabilities`, { headers })).json();
  log(`capabilities required=${caps.required.ok ? 'ok' : 'MISSING'}`);

  log('✅ M3 验证通过：model.list 真实读取 + 会话链路 + capabilities');
  proc.kill('SIGTERM');
  process.exit(0);
}

main().catch((e) => { log(`❌ ${e.message}`); proc.kill('SIGTERM'); process.exit(1); });
