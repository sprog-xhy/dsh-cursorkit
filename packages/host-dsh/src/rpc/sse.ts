/**
 * EventBus: assigns monotonic seq, keeps a bounded ring buffer for
 * incremental replay, and fans events out to SSE subscribers.
 *
 * @module @dsh-cursorkit/host-dsh/rpc/sse
 */

import type { CkpEvent } from '@dsh-cursorkit/protocol';
import type { RawCkpEvent } from '../bridge/session-bridge.ts';

/** Default ring buffer capacity. */
export const DEFAULT_RING_CAPACITY = 5000;

/** A subscription to the event bus. */
export interface BusSubscriber {
  /** Called synchronously for every emitted event. */
  onEvent(e: CkpEvent): void;
  /** Called when the bus shuts down (SSE connection should close). */
  onClose?(): void;
}

export class EventBus {
  private seq = 0;
  private readonly ring: CkpEvent[] = [];
  private readonly subscribers = new Set<BusSubscriber>();
  private closed = false;

  constructor(private readonly capacity: number = DEFAULT_RING_CAPACITY) {}

  /**
   * Emit a CKP event (without seq/ts — assigned here).
   * @returns the fully-qualified event as delivered.
   */
  emit(e: RawCkpEvent): CkpEvent {
    if (this.closed) throw new Error('EventBus is closed');
    const full = { ...e, seq: ++this.seq, ts: Date.now() } as unknown as CkpEvent;
    this.ring.push(full);
    if (this.ring.length > this.capacity) this.ring.shift();
    for (const s of this.subscribers) {
      try {
        s.onEvent(full);
      } catch (err) {
        // Observer failures are contained — never let one subscriber break the bus.
        console.error('[cursorkit] subscriber error:', err);
      }
    }
    return full;
  }

  /**
   * Events with seq strictly greater than `fromSeq`, in order.
   * Returns null when the requested window is older than the ring head
   * (the client must full-rebuild instead of incrementally replaying).
   */
  replayFrom(fromSeq: number): CkpEvent[] | null {
    if (fromSeq < (this.ring[0]?.seq ?? 0) - 1) return null;
    if (fromSeq >= this.seq) return [];
    return this.ring.filter((e) => e.seq > fromSeq);
  }

  /** Subscribe. Returns a disposer; on dispose the onClose callback fires. */
  subscribe(s: BusSubscriber): () => void {
    if (this.closed) {
      // No-op subscription on a closed bus.
      return () => {};
    }
    this.subscribers.add(s);
    return () => {
      this.subscribers.delete(s);
      s.onClose?.();
    };
  }

  get lastSeq(): number {
    return this.seq;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Shut the bus down: notify all subscribers, drop state. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const s of [...this.subscribers]) {
      try {
        s.onClose?.();
      } catch {
        // ignore
      }
    }
    this.subscribers.clear();
  }
}
