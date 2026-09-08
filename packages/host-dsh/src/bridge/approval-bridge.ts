/**
 * ApprovalBridge: pending-approval registry. Host-owned — dsh 0.1.1-rc.2 has no
 * tool-approval service (see docs/dsh-capability-audit.md §6.5), so the CKP
 * approval surface is implemented here and decisions are recorded into the
 * session log by the caller.
 *
 * @module @dsh-cursorkit/host-dsh/bridge/approval-bridge
 */

import type { ApprovalDecision, ApprovalRequest, CkpEvent } from '@dsh-cursorkit/protocol';
import type { EventBus } from '../rpc/sse.ts';

export interface PendingApproval {
  id: string;
  sessionId: string;
  tool: string;
  args: unknown;
  reason?: string;
  createdAt: number;
  timeoutMs: number;
  decision?: ApprovalDecision;
  resolve(d: ApprovalDecision): void;
  reject(e: Error): void;
}

export interface ApprovalBridgeOptions {
  bus: EventBus;
  /** Default timeout for an approval request. */
  timeoutMs?: number;
}

export class ApprovalBridge {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly bus: EventBus;
  private readonly timeoutMs: number;

  constructor(opts: ApprovalBridgeOptions) {
    this.bus = opts.bus;
    this.timeoutMs = opts.timeoutMs ?? 300_000;
  }

  /**
   * Create a pending approval, broadcast `approval.request`, and arm the
   * timeout. Returns the pending handle so the caller can wire it to dsh.
   */
  create(
    sessionId: string,
    tool: string,
    args: unknown,
    reason?: string,
  ): PendingApproval {
    const id = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let settle: (d: ApprovalDecision) => void = () => {};
    let fail: (e: Error) => void = () => {};

    const handle: PendingApproval = {
      id,
      sessionId,
      tool,
      args,
      reason,
      createdAt: Date.now(),
      timeoutMs: this.timeoutMs,
      resolve: (d) => settle(d),
      reject: (e) => fail(e),
    };

    const timeout = setTimeout(() => {
      // Auto-deny on timeout and broadcast the resolution.
      this.resolve(handle, 'deny', true);
    }, this.timeoutMs);
    // Keep the process alive while approvals are pending.
    timeout.unref?.();

    this.pending.set(id, handle);
    this.timeouts.set(id, timeout);

    this.bus.emit({
      sessionId,
      type: 'approval.request',
      approval: this.toCkpApproval(handle),
    } as Omit<CkpEvent, 'seq' | 'ts'>);

    handle.resolve = (d) => this.resolve(handle, d, false);
    handle.reject = (e) => {
      this.cleanup(id);
      fail(e);
    };
    settle = (d) => {
      this.cleanup(id);
      this.bus.emit({
        sessionId: handle.sessionId,
        type: 'approval.resolved',
        approvalId: handle.id,
        decision: d,
      } as Omit<CkpEvent, 'seq' | 'ts'>);
    };

    return handle;
  }

  /** Respond to a pending approval. Returns false when unknown/expired. */
  respond(approvalId: string, decision: ApprovalDecision): boolean {
    const handle = this.pending.get(approvalId);
    if (!handle) return false;
    handle.resolve(decision);
    return true;
  }

  /** Timeout-based auto-deny used internally. */
  private resolve(handle: PendingApproval, decision: ApprovalDecision, fromTimeout: boolean): void {
    if (!this.pending.has(handle.id)) return;
    this.cleanup(handle.id);
    this.bus.emit({
      sessionId: handle.sessionId,
      type: 'approval.resolved',
      approvalId: handle.id,
      decision,
      data: fromTimeout ? { reason: 'timeout' } : undefined,
    } as unknown as Omit<CkpEvent, 'seq' | 'ts'>);
    handle.decision = decision;
  }

  /** Deny everything and clear state (session close / host shutdown). */
  close(): void {
    for (const handle of [...this.pending.values()]) {
      this.resolve(handle, 'deny', true);
    }
    this.pending.clear();
    this.timeouts.clear();
  }

  private cleanup(id: string): void {
    const t = this.timeouts.get(id);
    if (t) clearTimeout(t);
    this.timeouts.delete(id);
    this.pending.delete(id);
  }

  private toCkpApproval(h: PendingApproval): ApprovalRequest {
    return {
      id: h.id,
      sessionId: h.sessionId,
      tool: h.tool,
      args: h.args,
      reason: h.reason,
      expiresAt: h.createdAt + h.timeoutMs,
      risks: inferRisks(h.tool),
    };
  }
}

/** Infer risk categories from the tool name (best-effort, display only). */
export function inferRisks(tool: string): ApprovalRequest['risks'] {
  const risks: ApprovalRequest['risks'] = [];
  if (/write|edit|create|rm|delete|mkdir|mv|cp|apply|patch/i.test(tool)) risks.push('write');
  if (/bash|shell|exec|run|terminal|sh$/i.test(tool)) risks.push('shell');
  if (/http|fetch|curl|net|web|request|api/i.test(tool)) risks.push('network');
  if (risks.length === 0) risks.push('other');
  return risks;
}
