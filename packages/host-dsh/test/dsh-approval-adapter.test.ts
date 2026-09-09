import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/rpc/sse.ts';
import { ApprovalBridge } from '../src/bridge/approval-bridge.ts';
import { createDshAnswerer, registerDshAnswerer, type ApprovalOutcome } from '../src/bridge/dsh-approval-adapter.ts';

/** Simulate dsh's approval/request waterfall dispatch. */
function dispatch(
  answerer: (req: unknown, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>,
  req: unknown,
): Promise<ApprovalOutcome> {
  return answerer(req, () => Promise.resolve('unavailable'));
}

describe('dsh approval adapter', () => {
  it('turns a dsh approval request into CKP events and answers allowed-once', async () => {
    const bus = new EventBus();
    const bridge = new ApprovalBridge({ bus });
    const answerer = createDshAnswerer({ bridge, bus });

    const req = { agent: { id: 's1', session: { id: 's1' } }, toolName: 'bash', reason: 'run' };
    const outcomePromise = dispatch(answerer, req);

    // CKP approval.request was broadcast; find the pending id.
    const approvalId = bridge['pending'].keys().next().value as string;
    expect(approvalId).toBeTruthy();

    bridge.respond(approvalId, 'once');
    expect(await outcomePromise).toBe('allowed-once');
  });

  it('returns rejected when the user denies', async () => {
    const bus = new EventBus();
    const bridge = new ApprovalBridge({ bus });
    const answerer = createDshAnswerer({ bridge, bus });

    const req = { agent: { id: 's1', session: { id: 's1' } }, toolName: 'bash' };
    const outcomePromise = dispatch(answerer, req);
    const approvalId = bridge['pending'].keys().next().value as string;
    bridge.respond(approvalId, 'deny');
    expect(await outcomePromise).toBe('rejected');
  });

  it('returns cancelled when the dsh signal aborts', async () => {
    const bus = new EventBus();
    const bridge = new ApprovalBridge({ bus });
    const answerer = createDshAnswerer({ bridge, bus });

    const ac = new AbortController();
    const req = { agent: { id: 's1', session: { id: 's1' } }, toolName: 'bash', signal: ac.signal };
    const outcomePromise = dispatch(answerer, req);
    ac.abort();
    expect(await outcomePromise).toBe('cancelled');
  });

  it('fails closed when the session cannot be attributed', async () => {
    const bus = new EventBus();
    const bridge = new ApprovalBridge({ bus });
    const answerer = createDshAnswerer({ bridge, bus });
    expect(await dispatch(answerer, { agent: {}, toolName: 'bash' })).toBe('unavailable');
  });

  it('registerDshAnswerer no-ops without the approval seam', () => {
    const bus = new EventBus();
    const bridge = new ApprovalBridge({ bus });
    const dispose = registerDshAnswerer({}, { bridge, bus });
    expect(typeof dispose).toBe('function');
    dispose();
  });
});
