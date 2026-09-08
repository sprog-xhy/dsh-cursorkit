/**
 * HTTP+SSE transport: RPC over fetch, events over SSE with seq resume.
 *
 * @module @dsh-cursorkit/client/transport/http
 */

import type { CkpEvent, Response as CkpResponse } from '@dsh-cursorkit/protocol';
import { CkpError } from '@dsh-cursorkit/protocol';
import type { Disposer, SubscribeOptions, Transport } from './types.ts';

export interface HttpTransportOptions {
  baseUrl: string;
  token: string;
  /** fetch implementation override (tests). */
  fetch?: typeof globalThis.fetch;
  /** Reconnect backoff base in ms. */
  backoffBaseMs?: number;
  /** Reconnect backoff cap in ms. */
  backoffMaxMs?: number;
}

export class HttpTransport implements Transport {
  readonly kind = 'http' as const;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;

  constructor(opts: HttpTransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.backoffMaxMs = opts.backoffMaxMs ?? 8000;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, ...extra };
  }

  async call<P = unknown, R = unknown>(
    method: string,
    params: P,
    opts?: { signal?: AbortSignal },
  ): Promise<R> {
    const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let res: globalThis.Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/rpc/${encodeURIComponent(method)}`, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ id: reqId, method, params }),
        signal: opts?.signal,
      });
    } catch (err) {
      throw new CkpError('TRANSPORT_ERROR', `network error calling ${method}: ${err instanceof Error ? err.message : String(err)}`);
    }
    let body: CkpResponse<R>;
    try {
      body = (await res.json()) as CkpResponse<R>;
    } catch {
      throw new CkpError('TRANSPORT_ERROR', `invalid response from ${method} (HTTP ${res.status})`);
    }
    if (res.status === 401) {
      throw new CkpError('PERMISSION_DENIED', 'unauthorized: invalid or missing token');
    }
    if (!body.ok) {
      throw new CkpError(body.error.code as never, body.error.message, body.error.data);
    }
    return body.result;
  }

  subscribe(sessionId: string, opts: SubscribeOptions): Disposer {
    let aborted = false;
    let currentAbort: AbortController | null = null;
    let backoffMs = this.backoffBaseMs;
    let lastSeq = opts.fromSeq;

    const connect = async () => {
      if (aborted) return;
      const ctrl = new AbortController();
      currentAbort = ctrl;
      const signal = opts.signal;
      if (signal?.aborted) {
        aborted = true;
        return;
      }
      if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

      const url = `${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/events?from=${lastSeq}`;
      try {
        const res = await this.fetchImpl(url, {
          headers: this.headers(),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new Error(`SSE HTTP ${res.status}`);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error('SSE: no body');

        // Successfully connected → reset backoff.
        backoffMs = this.backoffBaseMs;

        const decoder = new TextDecoder();
        let buffer = '';
        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const chunk of events) {
            for (const line of chunk.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload) continue;
              const e = JSON.parse(payload) as CkpEvent | { event: string; data: unknown };
              if ('event' in e && e.event === 'gap') {
                const data = e.data as { fromSeq?: number; lastSeq?: number };
                opts.onGap?.(data.fromSeq ?? lastSeq, data.lastSeq ?? lastSeq);
                // Gap → full rebuild: mark a gap so the store can rebuild from session.get.
                opts.onEvent({
                  seq: -1,
                  ts: Date.now(),
                  sessionId,
                  type: 'gap',
                  fromSeq: data.fromSeq ?? lastSeq,
                } as CkpEvent);
                continue;
              }
              if ('seq' in e) {
                lastSeq = e.seq;
                opts.onEvent(e as CkpEvent);
              }
            }
          }
        }
      } catch (err) {
        if (aborted) return;
        const reason = err instanceof Error ? err.message : String(err);
        if (signal?.aborted) {
          aborted = true;
          return;
        }
        // Reconnect with exponential backoff + jitter.
        await delay(backoffMs + Math.random() * backoffMs * 0.2);
        backoffMs = Math.min(backoffMs * 2, this.backoffMaxMs);
        if (!aborted) void connect();
      } finally {
        if (currentAbort === ctrl) currentAbort = null;
      }
    };

    void connect();

    return () => {
      aborted = true;
      currentAbort?.abort();
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
