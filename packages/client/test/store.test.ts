import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../src/store/create-store.ts';
import type { CkpEvent } from '@dsh-cursorkit/protocol';

function ev(seq: number, type: CkpEvent['type'], extra: Record<string, unknown> = {}): CkpEvent {
  return { seq, ts: 1000 + seq, sessionId: 's1', type, ...extra } as unknown as CkpEvent;
}

describe('createStore', () => {
  it('appends events and notifies subscribers', () => {
    const store = createStore('s1');
    const fn = vi.fn();
    store.subscribe(fn);
    store.append(ev(1, 'session.started', { workspace: '/w' }));
    expect(store.getState().meta?.workspace).toBe('/w');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('dedupes by seq (idempotent append)', () => {
    const store = createStore('s1');
    store.append(ev(1, 'message.user', { text: 'a' }));
    store.append(ev(1, 'message.user', { text: 'a' })); // duplicate seq
    store.append(ev(2, 'message.delta', { text: 'b' }));
    expect(store.getEvents()).toHaveLength(2);
  });

  it('rebuilds from a full log deterministically', () => {
    const store = createStore('s1');
    store.append(ev(1, 'message.user', { text: 'q' }));
    const log = store.getEvents();
    const rebuilt = createStore('s1');
    rebuilt.rebuild(log);
    expect(rebuilt.getState()).toEqual(store.getState());
  });

  it('tracks lastSeq and supports clear', () => {
    const store = createStore('s1');
    store.append(ev(1, 'message.user', { text: 'a' }));
    store.append(ev(2, 'message.user', { text: 'b' }));
    expect(store.lastSeq).toBe(2);
    store.clear();
    expect(store.getEvents()).toHaveLength(0);
    expect(store.getState().messages).toHaveLength(0);
  });

  it('unsubscribe stops notifications', () => {
    const store = createStore('s1');
    const fn = vi.fn();
    const off = store.subscribe(fn);
    off();
    store.append(ev(1, 'message.user', { text: 'a' }));
    expect(fn).not.toHaveBeenCalled();
  });
});
