/**
 * CKP client 封装（V2-DECISIONS D3/D5）：
 * 复用 @dsh-cursorkit/client 的 HttpTransport + CkpClient；
 * 扩展进程是唯一持 CKP 连接的地方，webview 通过 postMessage 交互。
 */
import { CkpClient, HttpTransport } from '@dsh-cursorkit/client';
import type { Session } from '@dsh-cursorkit/protocol';

export interface CkpSessionHandle {
  session: Session;
  client: CkpClient;
}

export class CkpService {
  private client: CkpClient | null = null;
  private activeSessionId: string | null = null;
  private transport: HttpTransport | null = null;
  private eventHandler: ((evt: unknown) => void) | null = null;
  private onceHandlers: ((evt: unknown) => void)[] = [];
  private disposer: (() => void) | null = null;

  /** 由 SidecarManager 就绪后注入 transport。 */
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
  }

  get ready(): boolean {
    return this.client !== null;
  }

  /** 订阅事件流（转发给 webview）。 */
  onEvent(handler: (evt: unknown) => void): void {
    this.eventHandler = handler;
  }

  /** 注册一次性事件监听（Ctrl+K 收集回复用），返回注销函数。 */
  onEventOnce(handler: (evt: unknown) => void): () => void {
    const wrapped = (evt: unknown): void => handler(evt);
    // 与 onEvent 共享同一 handler 链：把 wrapped 加进一个额外列表
    this.onceHandlers.push(wrapped);
    return () => {
      const i = this.onceHandlers.indexOf(wrapped);
      if (i >= 0) this.onceHandlers.splice(i, 1);
    };
  }

  /** 内部：把事件分发给常规 handler + 一次性 handlers。 */
  private dispatch(evt: unknown): void {
    this.eventHandler?.(evt);
    for (const h of this.onceHandlers) h(evt);
  }

  async ensureSession(workspace: string, model: string): Promise<Session> {
    if (!this.client) throw new Error('sidecar 未就绪');
    if (this.activeSessionId) {
      const detail = await this.client.sessionGet(this.activeSessionId);
      if (detail.workspace === workspace) return detail;
    }
    return this.newSession(workspace, model);
  }

  /** 无条件新建会话（Composer 多任务，V2-DECISIONS D20）。 */
  async newSession(workspace: string, model: string): Promise<Session> {
    if (!this.client) throw new Error('sidecar 未就绪');
    const s = await this.client.sessionCreate(workspace, { model });
    this.activeSessionId = s.id;
    this.attachEvents(s.id);
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

  /** 发送消息并等待 message.done 的完整文本（Tab 补全/行内编辑用）。 */
  async sendAndWaitText(sessionId: string, prompt: string): Promise<string | null> {
    if (!this.client) throw new Error('sidecar 未就绪');
    return new Promise((resolve) => {
      let collected = '';
      const timeout = setTimeout(() => resolve(collected || null), 45000);
      const off = this.transportSubscribeOnce(sessionId, (evt) => {
        const e = evt as { type?: string; text?: string };
        if (e?.type === 'message.delta' && typeof e.text === 'string') collected += e.text;
        else if (e?.type === 'message.done' || e?.type === 'done' || e?.type === 'error' || e?.type === 'cancelled') {
          clearTimeout(timeout);
          off();
          resolve(collected || null);
        }
      });
      void this.client!.sessionSend(sessionId, prompt, { mode: 'ask' }).catch(() => {
        clearTimeout(timeout);
        off();
        resolve(null);
      });
    });
  }

  /** 在 transport 上挂一次性订阅（补全/行内编辑专用，不碰聊天会话流）。 */
  private transportSubscribeOnce(sessionId: string, handler: (evt: unknown) => void): () => void {
    if (!this.transport) return () => undefined;
    const disposer = this.transport.subscribe(sessionId, {
      fromSeq: 0,
      onEvent: handler,
    });
    return disposer;
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
    this.activeSessionId = id;
    this.attachEvents(id);
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

  get sessionId(): string | null {
    return this.activeSessionId;
  }

  private attachEvents(sessionId: string): void {
    this.disposer?.();
    if (!this.client || !this.transport) return;
    this.disposer = this.transport.subscribe(sessionId, {
      fromSeq: 0,
      onEvent: (evt) => this.dispatch(evt),
    });
  }
}
