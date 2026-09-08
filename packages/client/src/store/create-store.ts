/**
 * EventStore: event-sourced session state.
 *
 * `state = events.reduce(rootReducer, init)`; append is idempotent by seq and
 * persists (throttled) to IndexedDB when available (doc §7.3, §10.4).
 *
 * @module @dsh-cursorkit/client/store/create-store
 */

import type { CkpEvent, StoreEvent } from '@dsh-cursorkit/protocol';
import type { SessionState } from './state.ts';
import { initialState } from './state.ts';
import { rootReducer } from './reducers/index.ts';
import { persistEvents, loadEvents, clearSession, hasIdb } from '../idb.ts';

export interface EventStore {
  /** Append one event (idempotent by seq). */
  append(e: CkpEvent | StoreEvent): void;
  /** Rebuild state from a full event log (replay). */
  rebuild(events: CkpEvent[]): void;
  getState(): SessionState;
  /** Current event log snapshot (ordered). */
  getEvents(): CkpEvent[];
  lastSeq: number;
  subscribe(fn: (s: SessionState) => void): () => void;
  /** Persist to IndexedDB now (unthrottled). */
  flush(): void;
  clear(): void;
}

export function createStore(sessionId: string, seed?: CkpEvent[]): EventStore {
  let events: CkpEvent[] = seed ? [...seed] : [];
  let state: SessionState = events.reduce(rootReducer, initialState());
  const listeners = new Set<(s: SessionState) => void>();

  // Throttled persistence.
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersist = () => {
    if (!hasIdb) return;
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistEvents(sessionId, events).catch(() => {});
    }, 500);
  };

  const notify = () => {
    for (const fn of listeners) fn(state);
  };

  return {
    get lastSeq(): number {
      return state.lastSeq;
    },

    append(e) {
      if (e.seq >= 0 && events.some((x) => x.seq === e.seq)) return; // idempotent
      events = [...events, e as CkpEvent];
      state = rootReducer(state, e);
      schedulePersist();
      notify();
    },

    rebuild(es) {
      events = [...es];
      state = events.reduce(rootReducer, initialState());
      notify();
    },

    getState: () => state,
    getEvents: () => [...events],

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    flush() {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      if (!hasIdb) return;
      void persistEvents(sessionId, events).catch(() => {});
    },

    clear() {
      events = [];
      state = initialState();
      if (hasIdb) void clearSession(sessionId).catch(() => {});
      notify();
    },
  };
}

/** Load persisted events for a session (returns null when absent). */
export async function loadStoredEvents(sessionId: string): Promise<CkpEvent[] | null> {
  if (!hasIdb) return null;
  try {
    return await loadEvents(sessionId);
  } catch {
    return null;
  }
}
