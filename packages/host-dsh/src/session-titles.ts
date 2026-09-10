/**
 * 会话标题回填：为**已存在的历史会话**补上标题。
 *
 * 背景：标题捕获（session/title 事件 + 首条用户消息）是后加的，
 * 此前创建的会话在索引里没有标题 → 会话列表只显示一串 id（用户可感知的缺失）。
 *
 * 做法：直接读 dsh 的持久化日志（`sessions/<ws>/<id>/session.jsonl.zstd`），
 * 解压后按 dsh 事件格式取 `session/title` 或首条真实用户消息。
 * 数据量很小（实测 27 个会话共 1MB），一次性后台完成。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

/**
 * 解压 dsh 的会话日志（可能是**多帧** zstd）。
 *
 * 实测：dsh 每次追加都写一个独立 zstd 帧（某会话文件 38 帧），
 * 而 Node 的 `zstdDecompressSync` / `createZstdDecompress` 都只解**第一帧**
 * （38KB 文件只得到 136 字节）。这里按帧魔数切分，逐帧解压后拼接。
 */
export function decompressSessionLog(buf: Buffer): Buffer {
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const positions: number[] = [];
  for (let i = buf.indexOf(MAGIC, 0); i !== -1; i = buf.indexOf(MAGIC, i + 4)) positions.push(i);
  if (positions.length <= 1) {
    try {
      return zstdDecompressSync(buf);
    } catch {
      return Buffer.alloc(0);
    }
  }
  const parts: Buffer[] = [];
  let i = 0;
  while (i < positions.length) {
    let end = i + 1;
    let piece: Buffer | null = null;
    while (end <= positions.length) {
      const slice = buf.subarray(positions[i], end < positions.length ? positions[end] : buf.length);
      try {
        piece = zstdDecompressSync(slice);
        break;
      } catch {
        end++; // 该切分点可能落在压缩数据里（魔数误命中）→ 继续放宽
      }
    }
    if (!piece) break;
    parts.push(piece);
    i = end;
  }
  return Buffer.concat(parts);
}

/** 读一个会话日志的首条标题候选（失败返回 undefined）。 */
export function titleFromSessionFile(file: string): string | undefined {
  try {
    const raw = decompressSessionLog(readFileSync(file)).toString('utf8');
    const events: unknown[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* ignore */
      }
    }
    return deriveFromEvents(events);
  } catch {
    return undefined;
  }
}

/**
 * 从事件数组里推导标题（与 router.deriveSessionTitle 同规则，独立实现避免循环依赖）。
 * 规则：优先 `session/title`；否则首条 source.kind==='user' 的 user/message。
 */
export function deriveFromEvents(events: readonly unknown[]): string | undefined {
  let firstUser = '';
  for (const e of events) {
    const ev = e as { type?: string; data?: Record<string, unknown> };
    if (ev.type === 'session/title') {
      const t = clean(ev.data?.title);
      if (t) return t;
    }
    if (!firstUser && ev.type === 'user/message') {
      const d = (ev.data ?? {}) as {
        source?: { kind?: string };
        content?: { text?: string }[];
        text?: string;
      };
      if (d.source?.kind === 'user' || d.source === undefined) {
        const text =
          (d.content ?? []).map((b) => (typeof b?.text === 'string' ? b.text : '')).join('') ||
          String(d.text ?? '');
        const c = clean(text);
        if (c) firstUser = c;
      }
    }
  }
  return firstUser || undefined;
}

function clean(v: unknown): string {
  return String(v ?? '')
    .replace(/\[模式[:：][\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * 扫描磁盘上所有会话日志，返回 id → 标题。
 * @param sessionsDir `$DSH_HOME/sessions`
 * @param need 只处理这些 id（其余跳过，避免无谓解压）
 */
export function scanTitlesOnDisk(sessionsDir: string, need: Set<string>): Map<string, string> {
  const found = new Map<string, string>();
  if (!existsSync(sessionsDir) || need.size === 0) return found;
  let workspaces: string[] = [];
  try {
    workspaces = readdirSync(sessionsDir);
  } catch {
    return found;
  }
  for (const ws of workspaces) {
    const wsDir = join(sessionsDir, ws);
    let ids: string[] = [];
    try {
      ids = readdirSync(wsDir);
    } catch {
      continue;
    }
    for (const id of ids) {
      if (!need.has(id) || found.has(id)) continue;
      const file = join(wsDir, id, 'session.jsonl.zstd');
      if (!existsSync(file)) continue;
      const title = titleFromSessionFile(file);
      if (title) found.set(id, title);
    }
    if (found.size >= need.size) break;
  }
  return found;
}
