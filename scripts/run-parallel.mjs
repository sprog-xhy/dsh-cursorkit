#!/usr/bin/env node
/**
 * M4 best-of-n 并行实证（T-051）：真实并行跑 n 个会话同一提示词，对比选优。
 *
 * 前置：sidecar 已启动（runtime.json 存在），demo-agent 已配真实模型
 * （kimi-k2.7-code / danger-full-access 可执行工具）。
 *
 * 用法：DSH_HOME=... node scripts/run-parallel.mjs --prompt "..." [--n 3] [--wait 90]
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const clientMod = await import(join(root, 'packages/client/lib/index.js'));
const { CkpClient, HttpTransport, createStore } = clientMod;

const args = process.argv.slice(2);
const prompt = argValue(args, '--prompt') ?? '用一句话介绍你自己';
const n = Number(argValue(args, '--n') ?? 3);
const waitMs = Number(argValue(args, '--wait') ?? 90_000);

const runtimePath = `${process.env.DSH_HOME ?? `${process.env.HOME}/.dsh`}/.cursorkit/runtime.json`;
const rt = JSON.parse(readFileSync(runtimePath, 'utf8'));
const client = new CkpClient({
  transport: new HttpTransport({ baseUrl: `http://127.0.0.1:${rt.port}`, token: rt.token }),
});

function waitFor(fn, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try { if (fn()) return resolve(); } catch { /* retry */ }
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout: ${label}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

console.log(`# M4 best-of-n 并行实证（n=${n}）`);
console.log(`prompt: ${prompt}\n`);

// 1. 并行发送同一提示词（使用预置的 declarative agent 会话）
const list = await client.sessionList();
const ids = list.map((x) => x.id).filter((id) => id.startsWith('session-parallel-')).slice(0, n);
if (ids.length < n) {
  console.error(`需要 ${n} 个预置并行会话，当前只有 ${ids.length} 个（session-parallel-*）`);
  process.exit(1);
}
const sessions = [];
for (let i = 0; i < n; i++) {
  const id = ids[i];
  const store = client.storeFor(id);
  const events = [];
  client.subscribeSession(id, { onEvent: (e) => events.push(e) });
  await client.sessionSend(id, prompt);
  sessions.push({ id, store, label: `#${i + 1}`, events });
  console.log(`  发送到会话 ${id}...`);
}

// 2. 等待所有会话产生 assistant 回复
console.log(`\n等待所有会话完成（≤${waitMs / 1000}s）...`);
await Promise.all(
  sessions.map((s) =>
    waitFor(() => {
      const msgs = s.store.getState().messages ?? [];
      return msgs.some((m) => m.role === 'assistant' && !m.pending && m.text.trim().length > 0);
    }, waitMs, `session ${s.id} assistant reply`).catch(() => false),
  ),
);
// 2b. 结算延迟：让流式 tool.done 事件到达 store
await new Promise((r) => setTimeout(r, 5000));

// 3. 收集结果并对比
console.log('\n=== 各会话结果 ===');
const results = sessions.map((s) => {
  const state = s.store.getState();
  const msgs = state.messages ?? [];
  const assistant = [...msgs].reverse().find((m) => m.role === 'assistant' && m.text.trim());
  const toolCalls = Object.values(state.toolCalls ?? {});
  let toolsRun = toolCalls.filter((t) => t.status === 'success').length;
  // Raw event fallback: count tool.call occurrences (authoritative).
  const toolCallsSeen = s.events.filter((e) => e.type === 'tool.call').length;
  const toolsDone = s.events.filter((e) => e.type === 'tool.done' && e.status === 'success').length;
  toolsRun = Math.max(toolsRun, toolsDone, toolCallsSeen);
  const text = assistant?.text ?? '(无回复)';
  return {
    label: s.label,
    id: s.id,
    text,
    chars: text.length,
    toolsRun,
    status: state.status,
  };
});

for (const r of results) {
  console.log(`${r.label} [${r.id}] tools=${r.toolsRun} chars=${r.chars} status=${r.status}`);
  console.log(`   → ${r.text.slice(0, 120)}${r.text.length > 120 ? '…' : ''}`);
}

// 4. best-of-n 选优：优先工具执行多 + 回复长
const sorted = [...results].sort((a, b) => (b.toolsRun - a.toolsRun) || (b.chars - a.chars));
console.log('\n=== best-of-n 选择 ===');
console.log(`选优: ${sorted[0].label} [${sorted[0].id}] (tools=${sorted[0].toolsRun}, chars=${sorted[0].chars})`);

process.exit(0);

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
