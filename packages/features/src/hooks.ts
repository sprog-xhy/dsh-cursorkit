/**
 * React bindings around CkpClient + EventStore.
 *
 * @module @dsh-cursorkit/features/hooks
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CkpClient, EventStore, SessionState } from '@dsh-cursorkit/client';
import type { CkpEvent, Session } from '@dsh-cursorkit/protocol';

/**
 * Provide the app-wide client. Must be created once at bootstrap
 * (see @dsh-cursorkit/features/bootstrap).
 */
export function useCkpClient(): CkpClient {
  const ref = useRef<CkpClient | null>(null);
  if (ref.current === null) {
    throw new Error('useCkpClient: no client bound — call bindClient() at bootstrap');
  }
  return ref.current;
}

/** Bind the singleton client for the app (bootstrap). */
export function bindClient(client: CkpClient): void {
  clientHolder.current = client;
}

const clientHolder = { current: null as CkpClient | null };

/** Subscribe a React component to an EventStore's state. */
export function useSessionState(store: EventStore | undefined): SessionState | null {
  const [state, setState] = useState<SessionState | null>(store?.getState() ?? null);

  useEffect(() => {
    if (!store) {
      setState(null);
      return;
    }
    setState(store.getState());
    return store.subscribe(setState);
  }, [store]);

  return state;
}

/** Subscribe to the live session list (refresh on demand). */
export function useSessionList(client: CkpClient, pollMs = 3000): {
  sessions: Session[];
  refresh: () => Promise<void>;
  loading: boolean;
} {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await client.sessionList();
      setSessions(list);
    } catch {
      // keep last list on transient errors
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { sessions, refresh, loading };
}

/**
 * Attach an EventStore to a session and stream its events. Returns the
 * store and a send helper. The store is created on demand per session id.
 */
export function useSession(client: CkpClient, sessionId: string | undefined) {
  const store = useMemo(() => (sessionId ? client.storeFor(sessionId) : undefined), [client, sessionId]);
  const state = useSessionState(store);

  useEffect(() => {
    if (!sessionId) return;
    const dispose = client.subscribeSession(sessionId, {});
    return dispose;
  }, [client, sessionId]);

  const send = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      await client.sendOptimistic(sessionId, text);
    },
    [client, sessionId],
  );

  const cancel = useCallback(async () => {
    if (!sessionId) return;
    await client.sessionCancel(sessionId);
  }, [client, sessionId]);

  const respondApproval = useCallback(
    async (approvalId: string, decision: 'once' | 'session' | 'always' | 'deny') => {
      await client.approvalRespond(approvalId, decision);
    },
    [client],
  );

  return { store, state, send, cancel, respondApproval };
}

/** A subscribe-once hook for ad-hoc event watching (e.g. for the StatusBar). */
export function useSessionEvents(
  client: CkpClient,
  sessionId: string | undefined,
  onEvent: (e: CkpEvent) => void,
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  useEffect(() => {
    if (!sessionId) return;
    return client.subscribeSession(sessionId, { onEvent: (e) => handlerRef.current(e) });
  }, [client, sessionId]);
}
