/**
 * M0 集成验证：模拟扩展的 sidecar 启动 + CKP 调用全链路。
 *
 * 与扩展代码相同的路径：spawn dsh --profile cursorkit --patch →
 * 轮询 runtime.json → HttpTransport → session.create → session.send → 事件流。
 *
 * 用法：DSH_HOME=$HOME/.dsh-cursorkit node scripts/verify-m0.mjs [text]
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// 独立数据目录：完全忽略 ambient DSH_HOME（V2-DECISIONS D24），
// 可用 CK_DSH_HOME 覆盖，默认 ~/.dsh-cursorkit
const DSH_HOME = process.env.CK_DSH_HOME ?? join(homedir(), '.dsh-cursorkit');
const PROMPT = process.argv[2] ?? '用一句话介绍你自己';
const MODEL = 'wps/moonshot/kimi-k2.7-code';

const runtimeFile = join(DSH_HOME, '.cursorkit', 'runtime.json');
const patch = join(DSH_HOME, 'profiles', 'cursorkit', 'cordis.patch.yml');

function log(msg) {
  console.log(`[verify-m0] ${msg}`);
}

// 1. 清理残留 runtime.json
try {
  const old = JSON.parse(readFileSync(runtimeFile, 'utf8'));
  try {
    process.kill(old.pid, 0);
    log(`发现存活 sidecar pid=${old.pid}，直接复用`);
  } catch {
    log(`清理残留 runtime.json (pid=${old.pid} 已死)`);
  }
} catch {
  /* 无残留 */
}

// 2. 启动 sidecar（profile 目录的 cordis.patch.yml 由 dsh 自动加载，无需 --patch）
log(`spawn dsh --profile cursorkit (DSH_HOME=${DSH_HOME})`);
const proc = spawn('dsh', ['--profile', 'cursorkit'], {
  env: {
    ...process.env,
    // 强制独立数据目录（V2-DECISIONS D24）：覆盖 ambient DSH_HOME
    DSH_HOME,
    DSH_PERMISSION_MODE: 'danger-full-access',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stdout?.on('data', (d) => log(`[dsh] ${String(d).trimEnd()}`));
proc.stderr?.on('data', (d) => log(`[dsh:err] ${String(d).trimEnd()}`));

// 3. 轮询 runtime.json（30s）
async function waitRuntime(ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const info = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      if (info.port && info.token) {
        try {
          process.kill(info.pid, 0);
          return info;
        } catch {
          /* pid 未存活，继续等 */
        }
      }
    } catch {
      /* 文件未就绪 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('sidecar 启动超时');
}

// 4. CKP 调用
async function main() {
  const info = await waitRuntime();
  log(`sidecar ready pid=${info.pid} port=${info.port} dsh=${info.dshVersion}`);

  const base = `http://127.0.0.1:${info.port}`;
  const headers = { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' };

  const call = async (method, params) => {
    const res = await fetch(`${base}/v1/rpc/${method}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: `req-${Date.now()}`, method, params }),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(`${method} 失败: ${JSON.stringify(body.error)}`);
    return body.result;
  };

  // 4.1 capability 探测（GET /v1/capabilities）
  const capsRes = await fetch(`${base}/v1/capabilities`, { headers });
  const caps = await capsRes.json();
  log(`capabilities: required=${caps.required?.ok ? 'ok' : 'MISSING'}`);
  if (!caps.required?.ok) throw new Error('required capabilities 不完整');

  // 4.2 创建会话
  const workspace = process.cwd();
  const session = await call('session.create', { workspace, model: MODEL });
  log(`session created: ${session.id} (${MODEL})`);

  // 4.3 订阅事件流（SSE）
  let userMsgSeen = false;
  let deltaSeen = false;
  let doneSeen = false;
  const eventSeen = [];
  const sub = (async () => {
    const res = await fetch(`${base}/v1/sessions/${session.id}/events?from=0`, { headers });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try {
          const evt = JSON.parse(line.slice(5));
          eventSeen.push(evt.type);
          if (evt.type === 'message.user') userMsgSeen = true;
          if (evt.type === 'message.delta') deltaSeen = true;
          if (evt.type === 'message.done') {
            doneSeen = true;
            // 打完就退出订阅
            return;
          }
        } catch {
          /* ignore */
        }
      }
    }
  })();

  // 4.4 发送消息
  await call('session.send', {
    id: session.id,
    text: PROMPT,
    // 与 dsh 消息格式一致：source + content blocks
    attachments: undefined,
  });
  log(`message sent: "${PROMPT}"`);

  // 4.5 等待完成（60s）
  await Promise.race([
    (async () => {
      while (!doneSeen) await new Promise((r) => setTimeout(r, 200));
    })(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('等待回复超时(60s)')), 60000)),
  ]);

  log(`事件序列: ${eventSeen.slice(0, 20).join(' → ')}${eventSeen.length > 20 ? ' …' : ''}`);
  if (!userMsgSeen) throw new Error('未收到 message.user');
  if (!deltaSeen) throw new Error('未收到 message.delta（模型无回复？）');
  if (!doneSeen) throw new Error('未收到 message.done');

  // 4.6 会话列表
  const sessions = await call('session.list', {});
  log(`会话总数: ${sessions.length}`);

  log('✅ M0 全链路验证通过：spawn → runtime → session.create → send → 流式事件 → done');
  process.exit(0);
}

main().catch((err) => {
  log(`❌ 验证失败: ${err.message}`);
  proc.kill('SIGTERM');
  process.exit(1);
});
