/**
 * EventBus: assigns monotonic seq, keeps a bounded ring buffer for
 * incremental replay, and fans events out to SSE subscribers.
 *
 * The ring can be persisted (see saveSnapshot/restoreSnapshot) so a host
 * restart — where dsh recovers session history — can still serve incremental
 * replay to a reconnecting client instead of forcing a full rebuild.
 *
 * @module @dsh-cursorkit/host-dsh/rpc/sse
 */

import type { CkpEvent } from '@dsh-cursorkit/protocol';
import type { RawCkpEvent } from '../bridge/session-bridge.ts';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';

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
   *
   * After a host restart the bus starts fresh: an empty ring with a non-zero
   * fromSeq is a GAP (the client's stored seqs belong to a previous host
   * process) — the client must full-rebuild rather than risk seq collisions.
   */
  replayFrom(fromSeq: number): CkpEvent[] | null {
    if (fromSeq < (this.ring[0]?.seq ?? 0) - 1) return null;
    if (fromSeq >= this.seq) {
      // Empty ring or fully caught up.
      return fromSeq === 0 || this.ring.length > 0 ? [] : null;
    }
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

  /** JSON snapshot for cross-process durability (host graceful shutdown). */
  toJSON(): { seq: number; events: CkpEvent[] } {
    return { seq: this.seq, events: [...this.ring] };
  }

  /** Restore seq + ring from a previous snapshot. */
  restore(snapshot: { seq: number; events: CkpEvent[] }): void {
    if (this.closed || this.seq !== 0 || this.ring.length > 0) {
      throw new Error('EventBus.restore: bus already in use');
    }
    this.seq = snapshot.seq;
    this.ring.push(...snapshot.events.slice(-this.capacity));
  }

  /** Persist the ring to a file (best-effort; used on graceful shutdown). */
  async saveSnapshot(file: string): Promise<void> {
    const payload = JSON.stringify(this.toJSON());
    await writeFile(file, payload, { mode: 0o600 });
  }

  /** Synchronous variant — usable inside process signal/exit handlers. */
  saveSnapshotSync(file: string): void {
    try {
      writeFileSync(file, JSON.stringify(this.toJSON()), { mode: 0o600 });
    } catch {
      // best-effort on shutdown paths
    }
  }

  /** Restore from a snapshot file. Returns false when absent/invalid. */
  async restoreSnapshot(file: string): Promise<boolean> {
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as { seq?: number; events?: CkpEvent[] };
      if (typeof parsed.seq !== 'number' || !Array.isArray(parsed.events)) return false;
      this.restore({ seq: parsed.seq, events: parsed.events });
      return true;
    } catch {
      return false;
    }
  }

  /** Delete the snapshot file (startup after restore). */
  async clearSnapshot(file: string): Promise<void> {
    await rm(file, { force: true });
  }
}
