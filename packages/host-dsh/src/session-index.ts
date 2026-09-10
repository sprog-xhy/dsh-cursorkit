/**
 * 会话索引（落盘持久化）。
 *
 * 解决的问题（实测发现）：
 * - dsh 会把会话事件持久化到 `$DSH_HOME/sessions/`，但**重启后不会把旧会话载入内存**
 *   → `session.get` 报 SESSION_NOT_FOUND、`session.list` 为空
 *   → 前端表现为「重启后历史会话全部消失、无法继续」
 * - dsh 的会话本身也不记录用户选择的模型
 *
 * 因此这里维护一份轻量索引：sessionId → { model, workspace, createdAt }，
 * 启动时加载、变更时防抖写盘。`session.list` 用它补全历史会话，
 * `session.send` 对非活跃会话先用 `agents.resume` 恢复再发送。
 *
 * 设计要点：
 * - 原子写（tmp + rename），0600；写失败只告警（退化为内存态）
 * - 上限 N 条，超出丢弃最旧
 */
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** 持久化上限（超出时丢弃最旧的条目）。 */
export const MAX_ENTRIES = 200;

/** 一条会话索引记录。 */
export interface SessionIndexEntry {
  /** 创建该会话时使用的模型（`provider/model-id`）。 */
  model: string;
  /** 工作目录（绝对路径）。 */
  workspace: string;
  /** 创建时间（epoch ms）。 */
  createdAt: number;
  /** 会话标题（dsh 的 session/title 事件；用于会话列表/顶栏展示）。 */
  title?: string;
  /** 标题来源：user=用户手动重命名（不被自动标题覆盖）。 */
  titleSource?: 'user' | 'auto';
}

export interface SessionIndexOptions {
  file: string;
  onWarn?: (message: string) => void;
  debounceMs?: number;
}

/** 会话索引（内存 + 落盘）。 */
export class SessionIndex {
  private readonly map = new Map<string, SessionIndexEntry>();
  private timer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(private readonly opts: SessionIndexOptions) {
    this.debounceMs = opts.debounceMs ?? 400;
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.opts.file, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, Partial<SessionIndexEntry>>;
      for (const [id, v] of Object.entries(parsed)) {
        if (!v || typeof v !== 'object') continue;
        if (typeof v.model !== 'string') continue;
        this.map.set(id, {
          model: v.model,
          workspace: typeof v.workspace === 'string' ? v.workspace : '',
          createdAt: typeof v.createdAt === 'number' ? v.createdAt : Date.now(),
          ...(typeof v.title === 'string' && v.title ? { title: v.title } : {}),
          ...(v.titleSource === 'user' || v.titleSource === 'auto'
            ? { titleSource: v.titleSource }
            : {}),
        });
      }
    } catch {
      /* 文件不存在或损坏 → 空索引 */
    }
  }

  get(id: string): SessionIndexEntry | undefined {
    return this.map.get(id);
  }

  /** 仅取模型（`session.get`/`list` 回读用）。 */
  modelOf(id: string): string | undefined {
    return this.map.get(id)?.model;
  }

  /**
   * 记录/更新会话标题（dsh 的 session/title）。
   * 索引里没有该会话时创建只有标题的条目（模型/工作区留空）。
   */
  setTitle(id: string, title: string, source: 'user' | 'auto' = 'auto'): void {
    const cur = this.map.get(id);
    // 用户重命名过的标题不被自动标题覆盖（dsh 的标题可能晚到）
    if (cur?.titleSource === 'user' && source === 'auto') return;
    const next: SessionIndexEntry = cur
      ? { ...cur, title, titleSource: source }
      : { model: '', workspace: '', createdAt: Date.now(), title, titleSource: source };
    this.map.set(id, next);
    this.scheduleFlush();
  }

  /** 移除条目（会话删除）。 */
  remove(id: string): boolean {
    const had = this.map.delete(id);
    if (had) this.scheduleFlush();
    return had;
  }

  /** 仅取标题。 */
  titleOf(id: string): string | undefined {
    return this.map.get(id)?.title;
  }

  set(id: string, entry: SessionIndexEntry): void {
    this.map.set(id, entry);
    this.trim();
    this.scheduleFlush();
  }

  /** 全部条目（按创建时间倒序，新的在前）。 */
  all(): [string, SessionIndexEntry][] {
    return [...this.map.entries()].sort((a, b) => b[1].createdAt - a[1].createdAt);
  }

  get size(): number {
    return this.map.size;
  }

  /** 立即落盘。 */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const payload = `${JSON.stringify(Object.fromEntries(this.map), null, 2)}\n`;
    const file = this.opts.file;
    try {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp-${process.pid}`;
      await writeFile(tmp, payload, { mode: 0o600 });
      await rename(tmp, file);
    } catch (err) {
      this.opts.onWarn?.(
        `session-index 写入失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  private trim(): void {
    while (this.map.size > MAX_ENTRIES) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }
}

/**
 * 清洗会话标题。
 *
 * dsh 的标题由「首条用户消息」生成，而我们的模式提示会附在其后
 * （实测标题变成 `解释项目架构 [模式: Agent] 如果这个请求需要改动代码…`）。
 * 这里剥掉模式提示与多余空白。
 */
export function cleanSessionTitle(raw: string): string {
  return raw
    .replace(/\[模式[:：][\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** 索引文件路径（与 runtime.json 同目录）。 */
export function sessionIndexFile(dshHome: string): string {
  return join(dshHome, '.cursorkit', 'session-index.json');
}
