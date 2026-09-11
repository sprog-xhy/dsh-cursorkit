#!/usr/bin/env node
/**
 * agent-debug：让 agent（或人）**自己观察与驱动 VSCode 里的 CursorKit**。
 *
 * 解决的问题：此前只能"人肉点 + 口述现象 + 猜"，一个来回几分钟且经常猜错。
 * 本工具用 CDP（Chrome DevTools Protocol）直连真实运行中的 VSCode：
 *   - 列出窗口与 webview 目标
 *   - 对 webview **求值/点击/读 DOM**（等价于"我亲自点按钮"）
 *   - **截图**（整窗或只截 Chat 面板）→ agent 可用 read_image 直接"看"界面
 *   - 采集 console/未捕获异常（前端报错不再靠用户转述）
 *   - 读扩展活动日志（sidecar/发送/停止/审查/tool 调用）
 *
 * 前置：VSCode 以调试端口启动
 *   bash scripts/open-vscode.sh <folder> --debug        # 端口 9222
 *
 * 用法：
 *   node scripts/agent-debug.mjs list                     # 列出目标
 *   node scripts/agent-debug.mjs shot [-o out.png] [--full]  # 截 VSCode 窗口
 *   node scripts/agent-debug.mjs shot --chat              # 只截 Chat 面板区域
 *   node scripts/agent-debug.mjs dom [selector]           # 打印 webview DOM 片段
 *   node scripts/agent-debug.mjs digest                   # 关键 UI 状态摘要
 *   node scripts/agent-debug.mjs eval "<js>"              # 在 webview 里求值
 *   node scripts/agent-debug.mjs click "<selector>"       # 点击（等价于真人点击）
 *   node scripts/agent-debug.mjs type "<text>"            # 往输入框输入并可选回车
 *   node scripts/agent-debug.mjs errors [--seconds=8]     # 采集前端报错
 *   node scripts/agent-debug.mjs log [--n=40]             # 扩展活动日志尾部
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CK_CDP_PORT ?? 9333);
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'list';
const flag = (name, dflt) => {
  const i = argv.findIndex(
    (a) => a === `--${name}` || a.startsWith(`--${name}=`) || (name.length === 1 && a === `-${name}`),
  );
  if (i === -1) return dflt;
  const a = argv[i];
  if (a.includes('=')) return a.split('=').slice(1).join('=');
  return argv[i + 1] ?? true;
};
const has = (name) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const positional = argv.slice(1).filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '-o');

// ── CDP 客户端（零依赖：Node 自带 WebSocket） ────────────────────────────
class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', (e) => reject(new Error(String(e.message ?? e))), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
        else resolve(msg.result);
        return;
      }
      for (const fn of this.listeners) fn(msg);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 20000).unref?.();
    });
  }
  on(fn) {
    this.listeners.push(fn);
  }
  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

async function listTargets() {
  const res = await fetch(`${BASE}/json/list`);
  return await res.json();
}

/** 选工作台窗口目标（type=page 且 url 指向 code 应用）。 */
function pickWorkbench(targets) {
  return (
    targets.find((t) => t.type === 'page' && (t.url ?? '').startsWith('vscode-file://vscode-app')) ??
    targets.find((t) => t.type === 'page')
  );
}

/**
 * 选 Chat webview 目标。
 * 可能有多个 webview（侧边栏 Chat、面板 Chat、其它扩展），
 * 因此逐个探测：含 `.topbar` 的才是我们的 Chat。
 */
async function pickChatWebview(targets) {
  const candidates = targets.filter(
    (t) => (t.type === 'iframe' || t.type === 'page') && (t.url ?? '').startsWith('vscode-webview://'),
  );
  for (const t of candidates) {
    const cdp = new Cdp(t.webSocketDebuggerUrl);
    try {
      await cdp.connect();
      const r = await cdp.send('Runtime.evaluate', {
        expression: wrap(`return !!document.querySelector('.topbar') && !!document.querySelector('.composer');`),
        returnByValue: true,
      });
      if (r?.result?.value === true) return { target: t, cdp };
    } catch {
      /* 换下一个 */
    }
    cdp.close();
  }
  // 退路：只有一个 webview 时就用它
  if (candidates.length === 1) {
    const cdp = new Cdp(candidates[0].webSocketDebuggerUrl);
    await cdp.connect();
    return { target: candidates[0], cdp };
  }
  throw new Error(
    `找不到 Chat webview（候选 ${candidates.length} 个）。请先打开 Chat：code --open-url vscode://sprogx.dsh-cursorkit/chat`,
  );
}

/**
 * 把用户表达式包进「内层文档」上下文。
 *
 * VSCode webview 是两层的：外层是 `vscode-webview://<id>` 宿主页，
 * 我们的 HTML 在内层 iframe 里（同名 origin → 可用 contentDocument 直接访问）。
 * 不穿透就会得到空 DOM（曾误判成"白屏"）。
 */
function wrap(body) {
  const isStatement = /(^|[\s;{(])return[\s;(]/.test(body);
  const inner = isStatement ? body : `return (${body});`;
  return `(() => {
    const __outerDoc = globalThis.document;
    const __outerWin = globalThis.window;
    const __frame = [...__outerDoc.querySelectorAll('iframe')].find((f) => {
      try { return f.contentDocument && (f.contentDocument.querySelector('.app') || f.contentDocument.querySelector('.topbar')); } catch (e) { return false; }
    });
    const document = __frame ? __frame.contentDocument : __outerDoc;
    const window = document.defaultView || __outerWin;
    // 支持两种写法：表达式（自动 return）与含 return 的语句体
    return (() => { ${inner} })();
  })()`;
}

/** 在 webview（内层文档）里求值（返回 JS 值）。 */
async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: wrap(expression),
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      `求值异常: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
    );
  }
  return r.result?.value;
}

/** Chat 面板在窗口内的位置（用于只截面板区域）。 */
const CHAT_RECT_JS = `(() => {
  // 工作台页面与 webview 跨源 → 只能按 DOM 结构/几何位置找，不能读 contentDocument
  const cands = [...document.querySelectorAll('iframe.webview, iframe')].filter((f) => {
    const r = f.getBoundingClientRect();
    return r.width > 80 && r.height > 80;
  });
  if (cands.length === 0) return null;
  // 取面积最大的一个（Chat 面板通常是主区域）
  const best = cands.sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return rb.width * rb.height - ra.width * ra.height;
  })[0];
  const r = best.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), count: cands.length };
})()`;

async function cmdList() {
  const targets = await listTargets();
  console.log(`CDP 端口 ${PORT}：${targets.length} 个目标`);
  for (const t of targets) {
    console.log(`  [${t.type}] ${(t.title || '').slice(0, 46).padEnd(48)} ${(t.url || '').slice(0, 60)}`);
  }
  const wb = pickWorkbench(targets);
  console.log(`\n工作台窗口：${wb ? wb.title : '未找到'}`);
  try {
    const { cdp } = await pickChatWebview(targets);
    const info = await evaluate(
      cdp,
      `JSON.stringify({topbar:!!document.querySelector('.topbar'),messages:document.querySelectorAll('.msg').length,changes:document.querySelectorAll('.change-card').length})`,
    );
    console.log('Chat webview：已找到', info);
    cdp.close();
  } catch (err) {
    console.log(`Chat webview：${err.message}`);
  }
}

async function cmdShot() {
  const full = has('full');
  const chatOnly = has('chat');
  const out = String(flag('o', '/tmp/ck-shot.png'));
  const targets = await listTargets();
  const wb = pickWorkbench(targets);
  if (!wb) throw new Error('找不到工作台窗口目标');
  const cdp = new Cdp(wb.webSocketDebuggerUrl);
  await cdp.connect();
  const params = { format: 'png' };
  if (chatOnly) {
    const rect = await evaluateRaw(cdp, CHAT_RECT_JS);
    if (!rect) throw new Error('窗口内没有可见的 webview iframe（Chat 面板可能没打开）');
    params.clip = { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 };
  } else if (!full) {
    const size = await evaluate(cdp, `({w:window.innerWidth,h:window.innerHeight})`);
    params.clip = { x: 0, y: 0, width: size.w, height: size.h, scale: 1 };
  }
  const r = await cdp.send('Page.captureScreenshot', params);
  writeFileSync(out, Buffer.from(r.data, 'base64'));
  cdp.close();
  const kb = (readFileSync(out).length / 1024).toFixed(0);
  console.log(`截图已保存：${out}（${kb}KB）${chatOnly ? '（仅 Chat 面板）' : ''}`);
}

async function withWebview(fn) {
  const targets = await listTargets();
  const { cdp, target } = await pickChatWebview(targets);
  try {
    return await fn(cdp, target);
  } finally {
    cdp.close();
  }
}

/** 直接对工作台窗口页面求值（不穿透 webview 内层）。 */
async function withWorkbench(fn) {
  const targets = await listTargets();
  const wb = pickWorkbench(targets);
  if (!wb) throw new Error('找不到工作台窗口目标');
  const cdp = new Cdp(wb.webSocketDebuggerUrl);
  await cdp.connect();
  try {
    return await fn(cdp, wb);
  } finally {
    cdp.close();
  }
}

/** 工作台页面里求值（原始表达式，不做内层穿透）。 */
async function evaluateRaw(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(`求值异常: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  }
  return r.result?.value;
}

async function cmdDigest() {
  await withWebview(async (cdp) => {
    const data = await evaluate(
      cdp,
      `JSON.stringify({
        status: (document.querySelector('[data-dsh="status"]')?.className || '').replace('dot status-',''),
        model: document.querySelector('[data-dsh="model"]')?.textContent || '',
        messages: document.querySelectorAll('.msg').length,
        userMsgs: document.querySelectorAll('.msg-user').length,
        assistantMsgs: document.querySelectorAll('.msg-assistant').length,
        changeCards: document.querySelectorAll('.change-card').length,
        pendingKeep: [...document.querySelectorAll('.change-card')].filter(c=>c.textContent.includes('保留')).length,
        thinkingBlocks: document.querySelectorAll('.thinking').length,
        panels: [...document.querySelectorAll('.panel-title')].map(e=>e.textContent),
        queued: document.querySelector('.queue-chip')?.textContent || '',
        busy: !!document.querySelector('.btn-stop'),
        emptyText: document.querySelector('.empty-title')?.textContent || '',
        mdRendered: { headings: document.querySelectorAll('.md-h').length, code: document.querySelectorAll('pre').length, tables: document.querySelectorAll('.md-table').length },
        viewport: window.innerWidth + 'x' + window.innerHeight,
        errors: window.__dshLastError || ''
      })`,
    );
    console.log(JSON.stringify(JSON.parse(data), null, 2));
  });
}

async function cmdDom() {
  const selector = positional[0] ?? '.app';
  const run = async (cdp) => {
    const html = await evaluate(
      cdp,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return '（未找到：${selector}）'; return el.outerHTML.slice(0, 4000); })()`,
    );
    console.log(html);
  };
  if (has('workbench')) await withWorkbench(run);
  else await withWebview(run);
}

async function cmdEval() {
  const expr = positional[0];
  if (!expr) throw new Error('用法：eval "<js>" [--workbench]');
  const run = async (cdp, raw) => {
    const v = raw ? await evaluateRaw(cdp, expr) : await evaluate(cdp, expr);
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  };
  if (has('workbench')) await withWorkbench((cdp) => run(cdp, true));
  else await withWebview((cdp) => run(cdp, false));
}

async function cmdClick() {
  const selector = positional[0];
  if (!selector) throw new Error('用法：click "<selector>"');
  await withWebview(async (cdp) => {
    // 真实派发鼠标事件（React 的 onClick 依赖 pointer/mouse 事件序列）
    const ok = await evaluate(
      cdp,
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'not-found';
        const r = el.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2, view: window };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        return 'clicked:' + (el.textContent || '').slice(0, 24);
      })()`,
    );
    console.log(ok);
  });
}

async function cmdType() {
  const text = positional[0] ?? '';
  const enter = has('enter');
  await withWebview(async (cdp) => {
    const res = await evaluate(
      cdp,
      `(() => {
        const ta = document.querySelector('.composer textarea');
        if (!ta) return 'no-textarea';
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${JSON.stringify(text)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ${enter ? `ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));` : ''}
        return 'typed:' + ta.value.slice(0, 40);
      })()`,
    );
    console.log(res);
  });
}

async function cmdErrors() {
  const seconds = Number(flag('seconds', 8));
  const targets = await listTargets();
  const wb = pickWorkbench(targets);
  const { cdp } = await pickChatWebview(targets);
  const found = [];
  const watch = (c, label) => {
    c.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails;
        found.push(`[${label}] 未捕获异常: ${d?.exception?.description ?? d?.text}`);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params?.type)) {
        found.push(`[${label}] console.${msg.params.type}: ${(msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')}`);
      }
      if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
        found.push(`[${label}] log: ${msg.params.entry.text}`);
      }
    });
  };
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable').catch(() => undefined);
  watch(cdp, 'webview');
  let wbCdp = null;
  if (wb) {
    wbCdp = new Cdp(wb.webSocketDebuggerUrl);
    await wbCdp.connect();
    await wbCdp.send('Runtime.enable');
    watch(wbCdp, 'workbench');
  }
  console.log(`采集 ${seconds}s 内的前端错误（现在去操作界面）…`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  cdp.close();
  wbCdp?.close();
  if (found.length === 0) console.log('✅ 没有采集到错误');
  else {
    console.log(`⚠️  采集到 ${found.length} 条：`);
    for (const f of found) console.log('  - ' + f);
  }
}

async function cmdLog() {
  const n = Number(flag('n', 40));
  const home = process.env.CK_DSH_HOME ?? join(homedir(), '.dsh-cursorkit');
  const file = join(home, '.cursorkit', 'activity.log');
  if (!existsSync(file)) {
    console.log(`（没有 ${file}）`);
    return;
  }
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (const l of lines.slice(-n)) console.log(l);
}

const COMMANDS = {
  list: cmdList,
  shot: cmdShot,
  digest: cmdDigest,
  dom: cmdDom,
  eval: cmdEval,
  click: cmdClick,
  type: cmdType,
  errors: cmdErrors,
  log: cmdLog,
};

const run = COMMANDS[cmd];
if (!run) {
  console.error(`未知命令：${cmd}\n可用：${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}
run()
  .catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref());
