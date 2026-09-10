/**
 * CkpClient facade: typed RPC + subscription wiring + per-session EventStore.
 *
 * @module @dsh-cursorkit/client
 */

import type {
  CkpEvent,
  CkpMethodName,
  ParamsOf,
  ResultOf,
  Session,
  SessionDetail,
  ApprovalDecision,
  FileChange,
  Checkpoint,
  ModelInfo,
} from '@dsh-cursorkit/protocol';
import type { Transport } from './transport/types.ts';
import type { EventStore } from './store/create-store.ts';
import { createStore } from './store/create-store.ts';
import { makeLocalMessage } from './optimistic.ts';

export type { Transport } from './transport/types.ts';
export { HttpTransport } from './transport/http.ts';
export type { HttpTransportOptions } from './transport/http.ts';
export { createStore } from './store/create-store.ts';
export type { EventStore } from './store/create-store.ts';
export * from './store/state.ts';
export * from './store/selectors.ts';
export { rootReducer, reduceEvents } from './store/reducers/index.ts';
export { makeLocalMessage } from './optimistic.ts';

export interface CkpClientOptions {
  transport: Transport;
}

export class CkpClient {
  readonly transport: Transport;
  private readonly stores = new Map<string, EventStore>();

  constructor(opts: CkpClientOptions) {
    this.transport = opts.transport;
  }

  /** Typed RPC dispatch. */
  async call<M extends CkpMethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    return this.transport.call<ParamsOf<M>, ResultOf<M>>(method, params);
  }

  // --- session convenience wrappers ---

  sessionList(): Promise<Session[]> {
    return this.call('session.list', {});
  }

  sessionCreate(workspace: string, opts?: { model?: string; worktree?: string }): Promise<Session> {
    return this.call('session.create', { workspace, ...opts });
  }

  sessionGet(id: string): Promise<SessionDetail> {
    return this.call('session.get', { id });
  }

  sessionFork(id: string, fromSeq?: number): Promise<Session> {
    return this.call('session.fork', { id, fromSeq });
  }

  sessionSend(
    id: string,
    text: string,
    opts?: { attachments?: unknown[]; mentions?: string[]; mode?: 'ask' | 'edit' | 'agent' },
  ): Promise<{ messageId: string }> {
    return this.call('session.send', { id, text, ...opts });
  }

  sessionCancel(id: string): Promise<void> {
    return this.call('session.cancel', { id });
  }

  approvalRespond(approvalId: string, decision: ApprovalDecision): Promise<void> {
    return this.call('approval.respond', { approvalId, decision });
  }

  diffGet(opts: { sessionId?: string; checkpointId?: string } = {}): Promise<FileChange[]> {
    return this.call('diff.get', opts);
  }

  contextGet(opts: {
    sessionId: string;
    files?: string[];
    selection?: string;
    prompt?: string;
  }): Promise<{
    sessionId: string;
    files?: string[];
    selection?: string;
    prompt?: string;
    injectedAt: number;
    summary: string;
  }> {
    return this.call('context.get', opts);
  }

  checkpointList(sessionId: string): Promise<Checkpoint[]> {
    return this.call('checkpoint.list', { sessionId });
  }

  checkpointRestore(checkpointId: string): Promise<Session> {
    return this.call('checkpoint.restore', { id: checkpointId });
  }

  modelList(): Promise<ModelInfo[]> {
    return this.call('model.list', {});
  }

  // --- event stream + store ---

  /**
   * Get (or lazily create) the event-sourced store for a session.
   * Feed it via `subscribeSession`.
   */
  storeFor(sessionId: string): EventStore {
    let store = this.stores.get(sessionId);
    if (!store) {
      store = createStore(sessionId);
      this.stores.set(sessionId, store);
    }
    return store;
  }

  /**
   * Subscribe to a session's event stream, appending into its store.
   * Returns a disposer. Events are idempotently applied (seq dedupe).
   */
  subscribeSession(
    sessionId: string,
    opts?: {
      fromSeq?: number;
      onEvent?: (e: CkpEvent) => void;
      onGap?: (fromSeq: number, lastSeq: number) => void;
    },
  ): () => void {
    const store = this.storeFor(sessionId);
    const fromSeq = opts?.fromSeq ?? store.lastSeq;
    return this.transport.subscribe(sessionId, {
      fromSeq,
      onEvent: (e) => {
        store.append(e);
        opts?.onEvent?.(e);
      },
      onGap: (from, last) => {
        // Gap: the host ring buffer can't replay — the caller should rebuild
        // (session.get + full replay). Notify and let the app decide.
        opts?.onGap?.(from, last);
      },
    });
  }

  /**
   * Send a message with optimistic UI: immediately append a local event to the
   * store, then send over RPC. When the server echoes `message.user`, the
   * local event stays (harmless) but the stream's authoritative copy wins by
   * seq ordering on rebuild.
   */
  async sendOptimistic(sessionId: string, text: string): Promise<{ messageId: string }> {
    const store = this.storeFor(sessionId);
    store.append(makeLocalMessage(sessionId, text));
    try {
      const res = await this.sessionSend(sessionId, text);
      return res;
    } catch (err) {
      // Mark the optimistic message as failed by clearing it from messages
      // (reducer keeps local messages only until the send resolves).
      store.rebuild(store.getEvents());
      throw err;
    }
  }

  /** Drop in-memory stores (e.g. on workspace switch). */
  dispose(): void {
    for (const store of this.stores.values()) store.clear();
    this.stores.clear();
  }
}
