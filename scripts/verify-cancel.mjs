/**
 * 取消链路验证：真实 sidecar 上 发起长任务 → session.cancel → 断言收到 cancelled 事件。
 *
 * 背景：bridge 曾把 dsh 的 `turn/end` 全部丢弃，导致取消后前端收不到任何事件、
 * busy 永远为 true（用户观感："点停止没反应"）。
 *
 * 用法：node scripts/verify-cancel.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DSH_HOME = process.env.CK_DSH_HOME ?? join(homedir(), '.dsh-cursorkit');
const WS = process.cwd();
const MODEL = 'wps/moonshot/kimi-k2.7-code';
const runtimeFile = join(DSH_HOME, '.cursorkit', 'runtime.json');

const log = (m) => console.log(`[verify-cancel] ${m}`);
const ok = (m) => console.log(`[verify-cancel] ✅ ${m}`);
const bad = (m) => {
  console.error(`[verify-cancel] ❌ ${m}`);
  process.exitCode = 1;
};

let proc = null;

async function syncDeps() {
  const { execFileSync } = await import('node:child_process');
  const repo = process.cwd();
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
    { stdio: 'pipe' },
  );
  const mod = await import(bundled);
  await mod.syncProfileDeps({
    dir: join(DSH_HOME, 'profiles', 'cursorkit'),
    hostDir: join(repo, 'packages', 'host-dsh'),
    protocolDir: join(repo, 'packages', 'protocol'),
    log: (m) => log(`[deps] ${m}`),
  });
}

async function boot() {
  if (existsSync(runtimeFile)) {
    try {
      const info = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      process.kill(info.pid, 0);
      log(`复用已有 sidecar pid=${info.pid}`);
      return info;
    } catch {
      rmSync(runtimeFile, { force: true });
    }
  }
  proc = spawn('dsh', ['--profile', 'cursorkit'], {
    env: { ...process.env, DSH_HOME, DSH_PERMISSION_MODE: 'danger-full-access' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr?.on('data', (d) => {
    const s = String(d).trim();
    if (s && /error|Error/.test(s)) log(`[dsh:err] ${s.slice(0, 160)}`);
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

async function main() {
  await syncDeps();
  const info = await boot();
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

  const session = await call('session.create', { workspace: WS, model: MODEL });
  log(`会话 ${session.id}`);

  // 订阅事件流（用 node:http，避免 vitest/undici 的 SSE 死锁问题在这里出现）
  const seen = [];
  const { default: http } = await import('node:http');
  let closed = false;
  const stream = new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: info.port,
        path: `/v1/sessions/${encodeURIComponent(session.id)}/events?from=0`,
        headers: { authorization: `Bearer ${info.token}` },
      },
      (res) => {
        res.setEncoding('utf8');
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk;
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const p of parts) {
            const line = p.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            try {
              const e = JSON.parse(line.slice(5));
              if (e.type) seen.push(e.type);
            } catch {
              /* ignore */
            }
          }
        });
        res.on('end', () => resolve(undefined));
      },
    );
    req.on('error', () => resolve(undefined));
    req.end();
    // 结束条件：拿到 cancelled 或超时
    const t = setInterval(() => {
      if (seen.includes('cancelled') || closed) {
        clearInterval(t);
        req.destroy();
        resolve(undefined);
      }
    }, 200);
  });

  // 发一个"长任务"，2s 后取消
  await call('session.send', {
    id: session.id,
    text: '请写一篇 2000 字的文章，逐段输出，慢慢写',
    mode: 'agent',
  });
  log('已发送长任务，2.5s 后请求取消…');
  await new Promise((r) => setTimeout(r, 2500));
  try {
    await call('session.cancel', { id: session.id });
    ok('session.cancel 调用成功');
  } catch (err) {
    bad(`session.cancel 失败：${err.message}`);
  }

  await Promise.race([stream, new Promise((r) => setTimeout(r, 12000))]);
  closed = true;

  log(`收到事件类型：${[...new Set(seen)].join(', ')}`);
  if (seen.includes('cancelled')) {
    ok('前端能收到 cancelled 事件（"停止"按钮从此有可见反馈）');
  } else {
    bad('未收到 cancelled 事件 —— 停止仍会"看起来没效果"');
  }
  // 确认 dsh 层确实中断
  try {
    const hist = await call('session.history', { id: session.id });
    const types = hist.events.map((e) => e.type);
    if (types.includes('cancelled')) ok('历史回放里也包含 cancelled（会话状态一致）');
    else log(`note: 历史事件类型 = ${[...new Set(types)].join(', ')}`);
  } catch (err) {
    log(`note: history 读取失败 ${err.message}`);
  }
  log('取消链路验证完成');
}

main()
  .catch((err) => bad(err.message))
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
  });
