/**
 * IndexedDB persistence for the event log (doc §10.4).
 *
 * Environment-guarded: in Node / SSR there is no indexedDB — degrade to no-op
 * instead of throwing. The store layers guard with `hasIdb`.
 *
 * @module @dsh-cursorkit/client/idb
 */

import type { CkpEvent } from '@dsh-cursorkit/protocol';

export const hasIdb: boolean =
  typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';

const DB_NAME = 'dsh-cursorkit';
const DB_VERSION = 1;
const STORE = 'sessions';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!hasIdb) return Promise.reject(new Error('indexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('open failed'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('tx failed'));
      }),
  );
}

/** Persist the full event log for a session (replace). */
export async function persistEvents(sessionId: string, events: CkpEvent[]): Promise<void> {
  if (!hasIdb) return;
  await tx('readwrite', (store) => store.put({ sessionId, events, updatedAt: Date.now() }));
}

/** Load persisted events for a session, or null. */
export async function loadEvents(sessionId: string): Promise<CkpEvent[] | null> {
  if (!hasIdb) return null;
  const rec = await tx<{ sessionId: string; events: CkpEvent[] } | undefined>('readonly', (store) =>
    store.get(sessionId) as IDBRequest<{ sessionId: string; events: CkpEvent[] } | undefined>,
  );
  return rec?.events ?? null;
}

/** Delete a session's stored log. */
export async function clearSession(sessionId: string): Promise<void> {
  if (!hasIdb) return;
  await tx('readwrite', (store) => store.delete(sessionId));
}
