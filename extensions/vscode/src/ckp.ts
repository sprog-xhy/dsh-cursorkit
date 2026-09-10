/**
 * CKP client 封装（V2-DECISIONS D3/D5）：
 * 复用 @dsh-cursorkit/client 的 HttpTransport + CkpClient；
 * 扩展进程是唯一持 CKP 连接的地方，webview 通过 postMessage 交互。
 *
 * 关键修复：
 * - 模型选择原先在已有会话上被静默忽略（切模型不生效）→ 显式模型跟踪 + 需要时重建会话
 * - 会话事件从 seq 0 重放导致跨会话消息串台 → 记录游标，切换时按需重放
 * - Tab 补全/行内编辑的一次性等待会累积历史 delta → 从当前游标订阅，并串行化同名会话请求
 * - onEvent 单回调 → 多监听（面板 + 侧边栏视图可同时订阅）
 */
import { CkpClient, HttpTransport } from '@dsh-cursorkit/client';
import type { Session } from '@dsh-cursorkit/protocol';

export interface CkpSessionHandle {
  session: Session;
  client: CkpClient;
}

export type CkpEventListener = (evt: unknown) => void;

export class CkpService {
  private client: CkpClient | null = null;
  private activeSessionId: string | null = null;
  private transport: HttpTransport | null = null;
  private readonly eventHandlers = new Set<CkpEventListener>();
  private disposer: (() => void) | null = null;
  /** 当前会话创建时使用的模型（null = 未知，如切换来的会话）。 */
  private activeSessionModel: string | null = null;
  /** 已完成回放的事件游标（避免切换会话时重复回放）。 */
  private replayCursor = 0;
  /** 一次性等待的串行队列（补全/行内编辑）。 */
  private readonly waitQueues = new Map<string, Promise<unknown>>();

  attach(transport: HttpTransport): void {
    this.transport = transport;
    this.client = new CkpClient({ transport });
  }

  detach(): void {
    this.disposer?.();
    this.disposer = null;
    this.client = null;
    this.transport = null;
    this.activeSessionId = null;
    this.activeSessionModel = null;
    this.replayCursor = 0;
    this.eventHandlers.clear();
    this.waitQueues.clear();
  }

  get ready(): boolean {
    return this.client !== null;
  }

  get sessionId(): string | null {
    return this.activeSessionId;
  }

  /** 订阅事件流（多监听；返回注销函数）。 */
  onEvent(handler: CkpEventListener): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private dispatch(evt: unknown): void {
    for (const h of this.eventHandlers) {
      try {
        h(evt);
      } catch {
        /* 单个监听抛错不影响其他监听 */
      }
    }
  }

  /**
   * 复用/新建会话。
   * 模型变化时重建会话（原实现忽略模型 → 选择模型后不生效）。
   */
  async ensureSession(workspace: string, model: string): Promise<Session> {
    if (!this.client) throw new Error('sidecar 未就绪');
    if (this.activeSessionId) {
      const detail = await this.client.sessionGet(this.activeSessionId);
      const sameWorkspace = detail.workspace === workspace;
      const sameModel = this.activeSessionModel === null || this.activeSessionModel === model;
      if (sameWorkspace && sameModel) return detail;
    }
    return this.newSession(workspace, model);
  }

  /** 无条件新建会话（Composer 多任务，V2-DECISIONS D20）。 */
  async newSession(workspace: string, model: string): Promise<Session> {
    if (!this.client) throw new Error('sidecar 未就绪');
    const s = await this.client.sessionCreate(workspace, { model });
    this.activeSessionId = s.id;
    this.activeSessionModel = model;
    this.replayCursor = 0;
    this.attachEvents(s.id, 0);
    return s;
  }

  private completionSessionId: string | null = null;

  /** Tab 补全专用会话（独立于聊天会话，避免互相干扰，V2-DECISIONS D8）。 */
  async ensureCompletionSession(workspace: string): Promise<{ id: string }> {
    if (!this.client) throw new Error('sidecar 未就绪');
    if (this.completionSessionId) return { id: this.completionSessionId };
    const s = await this.client.sessionCreate(workspace, {});
    this.completionSessionId = s.id;
    return { id: s.id };
  }

  /**
   * 发送消息并等待本轮完成文本（Tab 补全/行内编辑用）。
   *
   * - 从当前游标订阅（不重放历史，避免把上一轮的回复拼进来）
   * - 同一会话串行化（并发补全请求不互相抢事件）
   */
  async sendAndWaitText(
    sessionId: string,
    prompt: string,
    mode: 'ask' | 'edit' | 'agent' = 'ask',
  ): Promise<string | null> {
    if (!this.client || !this.transport) throw new Error('sidecar 未就绪');
    const client = this.client;
    const transport = this.transport;

    const prev = this.waitQueues.get(sessionId) ?? Promise.resolve();
    const run = prev.then(async (): Promise<string | null> => {
      let fromSeq = 0;
      try {
        const detail = await client.sessionGet(sessionId);
        fromSeq = detail.lastSeq ?? 0;
      } catch {
        /* 取不到游标则从头订阅（退化） */
      }
      return new Promise<string | null>((resolve) => {
        let collected = '';
        let settled = false;
        const done = (value: string | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          off();
          resolve(value);
        };
        const timer = setTimeout(() => done(collected || null), 45000);
        const off = transport.subscribe(sessionId, {
          fromSeq,
          onEvent: (evt) => {
            const e = evt as { type?: string; text?: string };
            if (e?.type === 'message.delta' && typeof e.text === 'string') {
              collected += e.text;
            } else if (
              e?.type === 'message.done' ||
              e?.type === 'done' ||
              e?.type === 'error' ||
              e?.type === 'cancelled'
            ) {
              done(collected || null);
            }
          },
        });
        void client
          .sessionSend(sessionId, prompt, { mode })
          .catch(() => done(null));
      });
    });

    this.waitQueues.set(
      sessionId,
      run.catch(() => null),
    );
    return run;
  }

  async sendMessage(
    text: string,
    opts?: { mentions?: string[]; mode?: 'ask' | 'edit' | 'agent' },
  ): Promise<void> {
    if (!this.client || !this.activeSessionId) throw new Error('会话未就绪');
    await this.client.sessionSend(this.activeSessionId, text, {
      mentions: opts?.mentions ?? [],
      mode: opts?.mode,
    });
  }

  async cancel(): Promise<void> {
    if (!this.client || !this.activeSessionId) return;
    await this.client.sessionCancel(this.activeSessionId);
  }

  async listSessions(): Promise<Session[]> {
    if (!this.client) return [];
    return this.client.sessionList();
  }

  async listModels() {
    if (!this.client) return [];
    return this.client.modelList();
  }

  async switchSession(id: string): Promise<void> {
    if (!this.client) return;
    let fromSeq = 0;
    let model: string | null = null;
    try {
      const detail = await this.client.sessionGet(id);
      fromSeq = detail.lastSeq ?? 0;
      // 协议 Session.model 现在由 host 回读（内存记录），可用则精确跟踪
      model = (detail as { model?: string }).model ?? null;
    } catch {
      /* 退化：从头回放 + 模型未知 */
    }
    this.activeSessionId = id;
    this.activeSessionModel = model;
    this.attachEvents(id, fromSeq);
  }

  async getSessionDetail(id: string) {
    if (!this.client) throw new Error('sidecar 未就绪');
    return this.client.sessionGet(id);
  }

  async checkpointList(sessionId: string) {
    if (!this.client) throw new Error('sidecar 未就绪');
    return this.client.checkpointList(sessionId);
  }

  async checkpointRestore(checkpointId: string) {
    if (!this.client) throw new Error('sidecar 未就绪');
    return this.client.checkpointRestore(checkpointId);
  }

  async diffGet(sessionId?: string) {
    if (!this.client) throw new Error('sidecar 未就绪');
    return this.client.diffGet(sessionId ? { sessionId } : {});
  }

  /**
   * 订阅会话事件。
   * @param fromSeq 0 = 回放完整历史（切换会话时用于重建消息流）
   */
  private attachEvents(sessionId: string, fromSeq: number): void {
    this.disposer?.();
    if (!this.client || !this.transport) return;
    this.disposer = this.transport.subscribe(sessionId, {
      fromSeq,
      onEvent: (evt) => this.dispatch(evt),
    });
  }
}
