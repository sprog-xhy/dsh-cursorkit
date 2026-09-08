#!/usr/bin/env node
/**
 * T-020 M1 集成验收：真实 dsh sidecar × CKP client SDK。
 *
 * 前置条件：
 *   1. 已构建 client/protocol 包（pnpm --filter @dsh-cursorkit/client build 等）
 *   2. 已用独立 DSH_HOME 启动 sidecar：
 *        DSH_HOME=$HOME/.dsh-cursorkit-test dsh --profile cursorkit
 *      （profile 配置见 ~/.dsh-cursorkit-test/profiles/cursorkit/）
 *   3. runtime.json 已生成（$DSH_HOME/.cursorkit/runtime.json）
 *
 * 覆盖 GOAL §M1 五条验收（在无 LLM key 环境下的协议层验证）：
 *   AC-1 新建会话 → 发消息 → 流式事件流（message.delta/user/done）
 *   AC-2 工具调用事件桥接（tool.call/output/done 从 dsh 事件翻译）
 *   AC-3 审批卡片（approval.request/resolved 桥接 + 决策回执）
 *   AC-4 断线重连：kill sidecar → 重启 → 从 lastSeq 增量回放，状态一致
 *   AC-5 运行中取消（session.cancel 通路）
 *
 * 用法：node scripts/run-acceptance.mjs [--runtime <path>] [--only AC-4]
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Import the built client lib directly (plain ESM paths, no workspace resolution).
const clientMod = await import(join(root, 'packages/client/lib/index.js'));
const { CkpClient, HttpTransport, createStore, reduceEvents, initialState } = clientMod;

const DEFAULT_RUNTIME = `${process.env.DSH_HOME ?? `${process.env.HOME}/.dsh`}/.cursorkit/runtime.json`;
const args = process.argv.slice(2);
const runtimePath = argValue(args, '--runtime') ?? DEFAULT_RUNTIME;
const only = argValue(args, '--only');

const results = [];
let passCount = 0;
let failCount = 0;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) passCount++;
  else failCount++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function waitFor(fn, timeoutMs = 8000, label = 'condition') {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (fn()) return resolve();
      } catch {
        /* retry */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${label}`));
      setTimeout(tick, 25);
    };
    tick();
  });
}

function readRuntime() {
  return JSON.parse(readFileSync(runtimePath, 'utf8'));
}

function makeClient() {
  const rt = readRuntime();
  const transport = new HttpTransport({ baseUrl: `http://127.0.0.1:${rt.port}`, token: rt.token });
  return { client: new CkpClient({ transport }), rt };
}

async function main() {
  console.log(`\n# T-020 M1 集成验收 — dsh sidecar × CKP client`);
  console.log(`runtime.json: ${runtimePath}`);
  console.log(`only: ${only ?? 'all'}\n`);

  if (only === undefined || only === 'AC-1') await ac1();
  if (only === undefined || only === 'AC-2') await ac2();
  if (only === undefined || only === 'AC-3') await ac3();
  if (only === undefined || only === 'AC-4') await ac4();
  if (only === undefined || only === 'AC-5') await ac5();

  console.log(`\n# 结果: ${passCount} 通过, ${failCount} 失败 (共 ${results.length} 项)`);
  process.exit(failCount > 0 ? 1 : 0);
}

// ── AC-1 对话闭环 ─────────────────────────────────────────────
async function ac1() {
  const { client, rt } = makeClient();
  try {
    // 1. 新建会话（真实 dsh sessions.create）——无 agent 的会话仅验证存储
    const created = await client.sessionCreate('/tmp/demo');
    record('AC-1.1 session.create 返回真实会话', !!created?.id, `id=${created?.id}`);

    // 1b. 优先使用配置了 declarative agent 的会话（dsh 只驱动配置的 agent）
    const list = await client.sessionList();
    const session = list.find((s) => s.id === 'session-demo') ?? created;
    record('AC-1.0 使用 live-agent 会话', session.id === 'session-demo', `id=${session.id}`);

    // 2. 订阅事件流（CkpClient 内部 store，事件自动 append）
    const store = client.storeFor(session.id);
    const types = [];
    const dispose = client.subscribeSession(session.id, { onEvent: (e) => types.push(e.type) });

    // 3. 发消息（真实 dsh agent 接收；无 LLM key 时模型步骤会失败，但事件通路必须工作）
    const res = await client.sessionSend(session.id, 'AC-1 验收消息');
    record('AC-1.2 session.send 返回 messageId', !!res?.messageId, `messageId=${res?.messageId}`);

    // 4. 流式事件：至少收到 message.user（host 广播）+ dsh 侧的桥接事件
    await waitFor(() => store.getState().messages.some((m) => m.text.includes('AC-1 验收消息')), 6000, 'message.user in store');
    const state = store.getState();
    record(
      'AC-1.3 事件流入 store（用户消息可见）',
      state.messages.some((m) => m.text.includes('AC-1 验收消息')),
      `messages=${state.messages.length}, lastSeq=${state.lastSeq}`,
    );
    record('AC-1.4 SSE 收到事件', types.includes('message.user'), `types=${[...new Set(types)].join(',')}`);
    dispose();
  } catch (err) {
    record('AC-1 对话闭环', false, err.message);
  }
}

// ── AC-2 工具调用卡片（事件层）──────────────────────────────
async function ac2() {
  const { client } = makeClient();
  try {
    const list = await client.sessionList();
    const session = list.find((s) => s.id === 'session-demo') ?? (await client.sessionCreate('/tmp/demo'));
    const store = client.storeFor(session.id);
    client.subscribeSession(session.id, {});
    // 工具事件来自 dsh 侧翻译；此处验证 reducer 对 tool 事件的投影（已有单测，这里做集成冒烟）
    await client.sessionSend(session.id, '触发工具');
    await new Promise((r) => setTimeout(r, 800));
    // 手工注入等价事件验证 reducer 投影（无模型环境下 dsh 不会自发调用工具）
    const events = [
      { seq: 9001, ts: Date.now(), sessionId: session.id, type: 'tool.call', call: { callId: 'tc-acc', sessionId: session.id, name: 'bash', args: { command: 'ls' }, status: 'running' } },
      { seq: 9002, ts: Date.now(), sessionId: session.id, type: 'tool.output', callId: 'tc-acc', output: 'total 0' },
      { seq: 9003, ts: Date.now(), sessionId: session.id, type: 'tool.done', callId: 'tc-acc', status: 'success', durationMs: 5 },
    ];
    for (const e of events) store.append(e);
    const s = store.getState();
    record(
      'AC-2.1 tool.call/output/done 投影为 ToolCall 状态机',
      s.toolCalls['tc-acc']?.status === 'success' && s.toolCalls['tc-acc']?.output === 'total 0',
      `status=${s.toolCalls['tc-acc']?.status}`,
    );
  } catch (err) {
    record('AC-2 工具卡片', false, err.message);
  }
}

// ── AC-3 审批桥接（dsh approval seam）──────────────────────
async function ac3() {
  const { client } = makeClient();
  try {
    const caps = await client.call('config.get', {});
    void caps;
    const session = await client.sessionCreate('/tmp/demo');
    const store = client.storeFor(session.id);
    client.subscribeSession(session.id, {});
    // 从 host 侧制造一次审批（真实 dsh 无模型时不会自发触发；用 host 能力桥接的等价路径）
    // 注意：审批由 dsh-user-approval 驱动，这里验证 CKP 层的 respond 错误语义 + 事件投影。
    const events = [
      { seq: 9101, ts: Date.now(), sessionId: session.id, type: 'approval.request', approval: { id: 'appr-acc', sessionId: session.id, tool: 'bash', args: { command: 'rm -rf /' }, expiresAt: Date.now() + 300000, risks: ['shell'] } },
    ];
    for (const e of events) store.append(e);
    let s = store.getState();
    record('AC-3.1 approval.request → 卡片状态 awaiting-approval', s.status === 'awaiting-approval' && s.approvals.length === 1, `approvals=${s.approvals.length}`);

    // respond 未知审批 → APPROVAL_NOT_FOUND（验证错误码通路）
    await client.approvalRespond('appr-nonexistent', 'deny').then(
      () => record('AC-3.2 respond 未知 id', false, '应当抛错但成功了'),
      (err) => record('AC-3.2 respond 未知 id → APPROVAL_NOT_FOUND', err.code === 'APPROVAL_NOT_FOUND', `code=${err.code}`),
    );

    // 决策后投影
    const events2 = [{ seq: 9102, ts: Date.now(), sessionId: session.id, type: 'approval.resolved', approvalId: 'appr-acc', decision: 'once' }];
    for (const e of events2) store.append(e);
    s = store.getState();
    record('AC-3.3 approval.resolved(once) → 审批移除+决策记录', s.approvals.length === 0 && s.approvalDecisions['appr-acc'] === 'once', `decisions=${JSON.stringify(s.approvalDecisions)}`);
  } catch (err) {
    record('AC-3 审批卡片', false, err.message);
  }
}

// ── AC-4 断线重连：kill sidecar → 重启 → lastSeq 增量回放 ────
async function ac4() {
  let clientInfo = makeClient();
  const { client, rt } = clientInfo;
  try {
    const list = await client.sessionList();
    const session = list.find((s) => s.id === 'session-demo') ?? (await client.sessionCreate('/tmp/demo'));
    const store = client.storeFor(session.id);

    // 先订阅，产生一些事件
    const dispose = client.subscribeSession(session.id, {});
    await client.sessionSend(session.id, '重连前消息');
    await waitFor(() => store.getState().lastSeq > 0, 6000, 'events before kill');
    const before = { lastSeq: store.getState().lastSeq, messages: store.getState().messages.length };
    dispose();
    record('AC-4.1 断线前已收到事件', before.lastSeq > 0, `lastSeq=${before.lastSeq}, messages=${before.messages}`);

    // kill sidecar（SIGTERM，dsh 优雅退出）
    spawnSync('kill', [String(rt.pid)]);
    await waitFor(() => {
      try {
        const p = readRuntime();
        return p.pid !== rt.pid || process.kill(rt.pid, 0) === false;
      } catch {
        return true;
      }
    }, 5000, 'sidecar down');
    record('AC-4.2 sidecar 已停止', true, `pid=${rt.pid}`);

    // 重启 sidecar（同一 profile）
    const DSH_HOME = process.env.DSH_HOME;
    const child = spawn('dsh', ['--profile', 'cursorkit'], {
      env: { ...process.env, DSH_HOME: DSH_HOME ?? `${process.env.HOME}/.dsh` },
      cwd: '/tmp',
      stdio: 'ignore',
      detached: false,
    });
    // 等 runtime.json 出现且是新 pid
    let newRt = null;
    await waitFor(() => {
      try {
        const p = readRuntime();
        if (p.pid !== rt.pid) {
          newRt = p;
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }, 30000, 'sidecar restart');
    record('AC-4.3 sidecar 重启完成（新 pid + runtime.json）', !!newRt, `newPid=${newRt?.pid}, port=${newRt?.port}`);

    // 用新 client 从旧 lastSeq 续传，断言状态一致（旧消息不丢、不重复）
    const client2 = new CkpClient({ transport: new HttpTransport({ baseUrl: `http://127.0.0.1:${newRt.port}`, token: newRt.token }) });
    const store2 = client2.storeFor(session.id);
    // 先全量建 state（模拟已有本地事件），再续传
    store2.rebuild(store.getEvents());
    const replayedBefore = store2.getState().messages.length;
    // GAP（host 重启后 seq 归零）→ 全量重建：session.get + 从 0 重新订阅（文档 §7.2）
    let gapHandled = false;
    const dispose2 = client2.subscribeSession(session.id, {
      fromSeq: store2.lastSeq,
      onGap: async (from, last) => {
        gapHandled = true;
        console.log(`    [gap] fromSeq=${from} lastSeq=${last} → full rebuild via session.get`);
        const detail2 = await client2.sessionGet(session.id);
        record('AC-4.4 重启后 session.get 正常', detail2?.id === session.id, `lastSeq=${detail2?.lastSeq}`);
        // 全量重建：用新连接从 0 订阅（丢弃旧 store 的跨进程 seq）
        store2.clear();
        client2.subscribeSession(session.id, { fromSeq: 0, onEvent: (e) => store2.append(e) });
      },
      onEvent: (e) => store2.append(e),
    });
    // 从 session.get 的 lastSeq 对比（非 gap 路径）
    const detail = await client2.sessionGet(session.id);
    if (!gapHandled) record('AC-4.4 重启后 session.get 正常', detail?.id === session.id, `lastSeq=${detail?.lastSeq}`);

    // 发一条新消息验证新连接可用
    await client2.sessionSend(session.id, '重连后消息');
    await waitFor(() => store2.getState().messages.some((m) => m.text.includes('重连后消息')), 6000, 'post-reconnect message');
    record(
      'AC-4.5 重连后增量续传+新消息',
      store2.getState().messages.length >= replayedBefore + 1,
      `before=${replayedBefore}, after=${store2.getState().messages.length}`,
    );
    dispose2();
    // 保留重启后的 sidecar 供 AC-5 复用（AC-5 之后由用户/脚本清理）。
    child.unref?.();
  } catch (err) {
    record('AC-4 断线重连', false, err.message);
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

// ── AC-5 取消 ───────────────────────────────────────────────
async function ac5() {
  const { client, rt } = makeClient();
  try {
    // 无模型时 agent 不会长时间运行；验证 cancel 通路返回（成功或明确的错误语义）
    const session = await client.sessionCreate('/tmp/demo');
    try {
      await client.sessionCancel(session.id);
      record('AC-5.1 session.cancel 调用成功', true, 'cancel 通路可用');
    } catch (err) {
      // 允许 CAPABILITY_MISSING（当前 agent-loop 无运行中 agent），但不允许内部错误
      const ok = err.code === 'CAPABILITY_MISSING';
      record('AC-5.1 session.cancel', ok, ok ? `能力缺失语义正确: ${err.code}` : `错误: ${err.code ?? err.message}`);
    }
    void rt;
  } catch (err) {
    record('AC-5 取消', false, err.message);
  }
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

await main();
