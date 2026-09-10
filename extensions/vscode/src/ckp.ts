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
