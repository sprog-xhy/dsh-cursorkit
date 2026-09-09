/**
 * Transport abstraction: the client SDK talks only to this interface, so the
 * HTTP+SSE transport and (later) the ACP stdio adapter are interchangeable.
 *
 * @module @dsh-cursorkit/client/transport/types
 */

import type { CkpEvent } from '@dsh-cursorkit/protocol';

export type Disposer = () => void;

export interface SubscribeOptions {
  /** Resume from this seq (inclusive replay window). */
  fromSeq: number;
  /** Called for each live event after the replay window. */
  onEvent(e: CkpEvent): void;
  /** Called when the server reports its ring buffer cannot cover fromSeq. */
  onGap?(fromSeq: number, lastSeq: number): void;
  /** Called when the underlying stream ends (connection lost). */
  onClose?(reason?: string): void;
  /** Abort the subscription. */
  signal?: AbortSignal;
}

export interface Transport {
  /** Typed RPC call; resolves with the method result, rejects with CkpError. */
  call<P = unknown, R = unknown>(method: string, params: P, opts?: { signal?: AbortSignal }): Promise<R>;
  /** Subscribe to a session's event stream, starting at fromSeq. */
  subscribe(sessionId: string, opts: SubscribeOptions): Disposer;
  readonly kind: 'http' | 'acp-stdio';
}
