/**
 * 使用过程监控：跟踪扩展活动日志与会话事件，自动标记异常。
 *
 * 输出（stdout 流式）：
 *   [act]  扩展活动日志新行（sidecar/uri/send/switch/tool/error…）
 *   [sess] 会话事件摘要（用户消息、助手回复、工具调用）
 *   [⚠️]   可疑/错误（agent error、工具失败、turn 以 error 结束、发送后无回复…）
 *
 * 用法：node scripts/watch-activity.mjs [间隔秒=3]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = process.env.CK_DSH_HOME ?? join(homedir(), '.dsh-cursorkit');
const ACT = join(HOME, '.cursorkit', 'activity.log');
const SESS = join(HOME, 'sessions');
const INTERVAL = Number(process.argv[2] ?? 3) * 1000;

const out = (tag, msg) => {
  const t = new Date().toISOString().slice(11, 19);
  process.stdout.write(`${t} ${tag} ${msg}\n`);
};

// --- 活动日志：记录已读行数 ---
let actLines = 0;
function pollActivity() {
  if (!existsSync(ACT)) return;
  try {
    const lines = readFileSync(ACT, 'utf8').split('\n').filter(Boolean);
    if (lines.length < actLines) actLines = 0; // 被轮转截断
    for (const l of lines.slice(actLines)) {
      const body = l.replace(/^\[[^\]]+\]\s*/, '');
      out(body.includes('error') || body.includes('失败') ? '[⚠️ act]' : '[act]', body);
    }
    actLines = lines.length;
  } catch {
    /* ignore */
  }
}

// --- 会话日志：按文件记录已读行数，解压后打印增量 ---
const sessSeen = new Map();
function pollSessions() {
  if (!existsSync(SESS)) return;
  const files = [];
  for (const ws of readdirSync(SESS)) {
    const wsDir = join(SESS, ws);
    try {
      for (const s of readdirSync(wsDir)) {
        const f = join(wsDir, s, 'session.jsonl.zstd');
        if (existsSync(f)) files.push({ f, id: s });
      }
    } catch {
      /* ignore */
    }
  }
  for (const { f, id } of files) {
    let lines;
    try {
      const raw = execFileSync('zstd', ['-dc', f], { maxBuffer: 64 << 20 }).toString('utf8');
      lines = raw.split('\n').filter(Boolean);
    } catch {
      continue;
    }
    const seen = sessSeen.get(f) ?? 0;
    // 文件被重写（行数变少）→ 从头读
    const from = lines.length < seen ? 0 : seen;
    for (const l of lines.slice(from)) {
      let evt;
      try {
        evt = JSON.parse(l);
      } catch {
        continue;
      }
      summarize(id, evt);
    }
    sessSeen.set(f, lines.length);
  }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
}

function summarize(sessionId, evt) {
  const t = evt.type;
  const d = evt.data ?? {};
  if (t === 'user/message') {
    const text = textOf(d.content).replace(/\s+/g, ' ').slice(0, 70);
    const src = d.source?.kind ?? '?';
    if (src === 'user') out('[sess]', `用户: ${text}`);
  } else if (t === 'assistant/message') {
    const text = textOf(d.message?.content ?? d.content).replace(/\s+/g, ' ').slice(0, 70);
    if (text) out('[sess]', `助手: ${text}`);
  } else if (t === 'tool/call') {
    out('[sess]', `工具: ${String(d.name ?? '?')}`);
  } else if (t === 'tool/result') {
    const block = Array.isArray(d.message?.content) ? d.message.content[0] : null;
    if (block?.isError) out('[⚠️ sess]', `工具失败: ${JSON.stringify(block).slice(0, 120)}`);
  } else if (t === 'turn/end') {
    const reason = d.reason?.kind ?? '?';
    if (reason === 'error') out('[⚠️ sess]', `回合以错误结束: ${JSON.stringify(d.reason).slice(0, 160)}`);
  } else if (t === 'error') {
    out('[⚠️ sess]', `会话错误: ${JSON.stringify(d).slice(0, 160)}`);
  }
}

out('[watch]', `监控中（activity.log + 会话事件，每 ${INTERVAL / 1000}s 轮询）HOME=${HOME}`);
pollActivity();
pollSessions();
setInterval(() => {
  pollActivity();
  pollSessions();
}, INTERVAL);
