/**
 * 验证「agent 改文件 → file.changed 事件」链路（Keep/Undo 卡片的前提）。
 *
 * 若这条链路不触发，聊天里就不会出现改动卡片，Keep/Undo 也就无从点起。
 * 用法：node scripts/verify-file-change.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import http from 'node:http';

const DSH_HOME = process.env.CK_DSH_HOME ?? join(homedir(), '.dsh-cursorkit');
const runtimeFile = join(DSH_HOME, '.cursorkit', 'runtime.json');
const log = (m) => console.log(`[verify-file-change] ${m}`);
const ok = (m) => console.log(`[verify-file-change] ✅ ${m}`);
const bad = (m) => {
  console.error(`[verify-file-change] ❌ ${m}`);
  process.exitCode = 1;
};

let proc = null;

async function syncDeps() {
  const { execFileSync } = await import('node:child_process');
  const repo = process.cwd();
  const bundled = '/tmp/ck-profile-config2.mjs';
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
    log: () => undefined,
  });
}

async function boot() {
  if (existsSync(runtimeFile)) {
    try {
      const info = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      process.kill(info.pid, 0);
      return info;
    } catch {
      rmSync(runtimeFile, { force: true });
    }
  }
  proc = spawn('dsh', ['--profile', 'cursorkit'], {
    env: { ...process.env, DSH_HOME, DSH_PERMISSION_MODE: 'danger-full-access' },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const info = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      if (info.port) {
        process.kill(info.pid, 0);
        return info;
      }
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('sidecar 启动超时');
}

async function main() {
  // 临时工作区（git 仓库，便于 diff/还原）
  const ws = join(tmpdir(), `ck-edit-${Date.now()}`);
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'a.txt'), 'original\n');
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q'], { cwd: ws });
  execFileSync('git', ['add', '-A'], { cwd: ws });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: ws });
  log(`临时工作区 ${ws}`);

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

  const session = await call('session.create', { workspace: ws });
  log(`会话 ${session.id}`);

  // 订阅事件流
  const seen = [];
  const done = new Promise((resolve) => {
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
              if (e.type) seen.push(e);
            } catch {
              /* ignore */
            }
          }
        });
        res.on('end', resolve);
      },
    );
    req.on('error', resolve);
    req.end();
    const t = setInterval(() => {
      if (seen.some((e) => e.type === 'done' || e.type === 'cancelled') || seen.length > 400) {
        clearInterval(t);
        req.destroy();
        resolve();
      }
    }, 300);
  });

  await call('session.send', {
    id: session.id,
    text: `把 a.txt 的内容改成 "changed by agent"，只改这一个文件。`,
    mode: 'agent',
  });
  await Promise.race([done, new Promise((r) => setTimeout(r, 120000))]);

  const changes = seen.filter((e) => e.type === 'file.changed');
  log(`收到事件类型：${[...new Set(seen.map((e) => e.type))].join(', ')}`);
  if (changes.length > 0) {
    ok(`file.changed 触发 ${changes.length} 次 → 聊天里会出现改动卡片（含 保留/撤销）`);
    for (const c of changes) log(`   ${c.change.path} (+${c.change.additions} -${c.change.deletions})`);
  } else {
    bad('没有 file.changed → 聊天里不会出现改动卡片（Keep/Undo 无从点起）');
  }

  // 文件是否真的被改了
  const after = readFileSync(join(ws, 'a.txt'), 'utf8').trim();
  if (after.includes('changed by agent')) ok(`文件已确实被改写：${JSON.stringify(after.slice(0, 40))}`);
  else log(`note: 文件内容 = ${JSON.stringify(after.slice(0, 40))}（agent 可能用了其它方式或未改）`);

  rmSync(ws, { recursive: true, force: true });
  log('完成');
}

main()
  .catch((err) => bad(err.message))
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref());
