/**
 * dsh approval adapter: bridge dsh's real `ctx.approval` seam into the CKP
 * approval surface.
 *
 * dsh 0.1.1-rc.2 (`@deepseek-ai/dsh-user-approval`) exposes:
 * - `ctx.approval.request(req)` → dispatches `approval/request` waterfall
 * - answerers register via `ctx.on('approval/request', (req, next) => …)`
 *   and return `ApprovalOutcome` (`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`)
 * - audit events `approval/asked` / `approval/decided` are logged by the service
 *
 * This adapter registers a CKP answerer: each dsh approval request becomes a
 * CKP `approval.request`, the UI responds via `approval.respond`, and the
 * decision is returned to dsh. Fail-closed: no answerer → dsh resolves
 * 'unavailable' by itself; we always answer within the timeout or deny.
 *
 * @module @dsh-cursorkit/host-dsh/bridge/dsh-approval-adapter
 */

import type { ApprovalBridge } from './approval-bridge.ts';
import type { EventBus } from '../rpc/sse.ts';

/** dsh's closed approval outcomes (see dsh-user-approval types). */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

/** Minimal dsh ApprovalRequest view (structural subset). */
export interface DshApprovalRequest {
  agent: { id: string; session?: { id: string } };
  toolName: string;
  callId?: string;
  reason?: string;
  signal?: AbortSignal;
}

/** An answerer returned by dsh's waterfall: either an outcome or a next() chain. */
export type DshNext = () => Promise<ApprovalOutcome>;

export interface DshApprovalAdapterOptions {
  bridge: ApprovalBridge;
  bus: EventBus;
  /** Timeout before auto-denying (ms). Must be < dsh's own patience. */
  timeoutMs?: number;
}

/**
 * Build the `approval/request` answerer to register with `ctx.on(...)`.
 * Returns an async function matching dsh's waterfall listener signature.
 */
export function createDshAnswerer(opts: DshApprovalAdapterOptions) {
  const { bridge, bus } = opts;
  const timeoutMs = opts.timeoutMs ?? 300_000;

  return async (
    req: DshApprovalRequest,
    _next: DshNext,
  ): Promise<ApprovalOutcome> => {
    const sessionId = req.agent?.session?.id ?? req.agent?.id ?? '';
    if (!sessionId) {
      // No session to attribute → fail closed.
      return 'unavailable';
    }

    // Create the pending approval in the CKP bridge; broadcast request.
    const pending = bridge.create(sessionId, req.toolName, req.callId ? { callId: req.callId } : {}, req.reason);

    // Wire the dsh signal: aborting the ask withdraws it.
    const signal = req.signal;
    let settled = false;
    let resolveOutcome: (o: ApprovalOutcome) => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      bridge.respond(pending.id, 'deny');
      bus.emit({
        sessionId,
        type: 'approval.resolved',
        approvalId: pending.id,
        decision: 'deny',
        reason: 'dsh-signal-abort',
      } as never);
      resolveOutcome('cancelled');
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return 'cancelled';
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    return new Promise<ApprovalOutcome>((resolve) => {
      resolveOutcome = resolve;
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Auto-deny on our own timeout (bridge already broadcasts resolved).
        bridge.respond(pending.id, 'deny');
        resolve('rejected');
      }, timeoutMs);

      // Patch the pending handle's resolve to feed the dsh outcome.
      const originalResolve = pending.resolve;
      pending.resolve = (d) => {
        if (settled) return;
        settled = true;
        originalResolve(d);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        switch (d) {
          case 'once':
          case 'session':
          case 'always':
            resolve('allowed-once');
            break;
          case 'deny':
            resolve('rejected');
            break;
        }
      };
    });
  };
}

/**
 * Register the answerer on a Cordis-like ctx. Returns a disposer.
 * Only registers when `ctx.on` exists and `ctx.approval` is present.
 */
export function registerDshAnswerer(
  ctx: {
    on?: (event: string, listener: (...args: unknown[]) => unknown) => unknown;
    approval?: unknown;
  },
  opts: DshApprovalAdapterOptions,
): () => void {
  const answerer = createDshAnswerer(opts);
  if (typeof ctx.on !== 'function' || !ctx.approval) {
    // No approval seam — the CKP surface still works standalone (host-owned).
    return () => {};
  }
  const handler = ctx.on('approval/request' as never, answerer as never);
  return () => {
    // dsh's ctx.on returns a disposer when a disposer is provided.
    if (typeof handler === 'function') (handler as () => void)();
  };
}
