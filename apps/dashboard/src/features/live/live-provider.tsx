'use client';

import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { queryKeys } from '@/lib/query-keys';
import type { EventSummary, Page } from '@/lib/types';
import { applyStatusChange, type LiveMessage, type LiveStatus, patchEventPages } from './messages';

/** Buffered new events are capped: the pill says "99+" and a refresh catches up. */
const MAX_BUFFER = 100;

interface LiveContextValue {
  status: LiveStatus;
  /** User-controlled pause (guidelines §4.2). Hidden tabs pause automatically. */
  paused: boolean;
  setPaused: (paused: boolean) => void;
  /** Retry after the stream gave up (e.g. the session expired, then the user signed in again). */
  reconnect: () => void;
  /** New events received but not yet shown in a list (newest first). */
  newEvents: EventSummary[];
  /** Messages may have been missed (reconnect): lists should offer a refresh. */
  stale: boolean;
  /** Called by a list when it shows the latest data: clears the buffer and the stale flag. */
  markCaughtUp: () => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

/** Live status for hooks: polling is only a fallback when this isn't `live`. */
export function useLive(): LiveContextValue | null {
  return useContext(LiveContext);
}

/**
 * One Server-Sent Events stream per workspace (ADR-0016). Messages update the
 * TanStack Query cache directly:
 *  - delivery changes patch event-list counts in place (rows never move) and
 *    refresh open detail views;
 *  - new events are buffered for a "↑ N new events" pill instead of being
 *    inserted under the user's cursor (guidelines §4.2);
 *  - notifications refresh the bell.
 * The browser reconnects by itself; after any gap we resync, because
 * messages are not replayed.
 */
export function LiveProvider({
  environmentId,
  children,
}: {
  environmentId: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  // Connection state is only ever set from callbacks (stream events, user
  // actions, visibility changes); the displayed status is derived from it.
  const [connection, setConnection] = useState<'live' | 'reconnecting' | 'offline' | null>(null);
  const [everLive, setEverLive] = useState(false);
  const [paused, setPausedState] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [newEvents, setNewEvents] = useState<EventSummary[]>([]);
  const [stale, setStale] = useState(false);
  const connectedOnce = useRef(false);

  const status: LiveStatus =
    paused || hidden ? 'paused' : (connection ?? (everLive ? 'reconnecting' : 'connecting'));

  useEffect(() => {
    const onVisibility = () => {
      setHidden(document.visibilityState === 'hidden');
      setConnection(null); // the stream is closed or about to reopen
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /** Refetch what's on screen; lists are only flagged, so rows don't jump. */
  const resync = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(environmentId) });
    void queryClient.invalidateQueries({ queryKey: ['deliveries', environmentId] });
    void queryClient.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === 'events' && q.queryKey[1] === environmentId && q.queryKey[2] === 'detail',
    });
    setStale(true);
  }, [queryClient, environmentId]);

  const handle = useCallback(
    (message: LiveMessage) => {
      switch (message.type) {
        case 'event.created':
          setNewEvents((prev) => [message.event, ...prev].slice(0, MAX_BUFFER));
          break;
        case 'delivery.updated': {
          const { eventId, deliveryId, from, to } = message;
          queryClient.setQueriesData<InfiniteData<Page<EventSummary>>>(
            { queryKey: ['events', environmentId, 'list'] },
            (data) => patchEventPages(data, eventId, from, to),
          );
          setNewEvents((prev) =>
            prev.some((e) => e.id === eventId)
              ? prev.map((e) => (e.id === eventId ? applyStatusChange(e, from, to) : e))
              : prev,
          );
          void queryClient.invalidateQueries({
            queryKey: queryKeys.deliveries.detail(environmentId, deliveryId),
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.events.detail(environmentId, eventId),
          });
          break;
        }
        case 'notification.created':
          void queryClient.invalidateQueries({
            queryKey: queryKeys.notifications.list(environmentId),
          });
          break;
      }
    },
    [queryClient, environmentId],
  );

  useEffect(() => {
    if (paused || hidden) return;
    const source = new EventSource(`/v1/environments/${environmentId}/stream`);

    source.addEventListener('ready', () => {
      setConnection('live');
      setEverLive(true);
      // Anything that happened while we weren't connected was missed.
      if (connectedOnce.current) resync();
      connectedOnce.current = true;
    });
    source.addEventListener('resync', resync);
    for (const type of ['event.created', 'delivery.updated', 'notification.created']) {
      source.addEventListener(type, (e) => {
        try {
          handle(JSON.parse((e as MessageEvent<string>).data) as LiveMessage);
        } catch {
          // ignore malformed messages
        }
      });
    }
    // EventSource retries by itself while CONNECTING; CLOSED means it gave up
    // (e.g. 401 after the session expired).
    source.onerror = () =>
      setConnection(source.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');

    return () => source.close();
  }, [environmentId, paused, hidden, attempt, handle, resync]);

  const value = useMemo<LiveContextValue>(
    () => ({
      status,
      paused,
      setPaused: (next: boolean) => {
        setPausedState(next);
        setConnection(null);
      },
      reconnect: () => {
        setConnection(null);
        setAttempt((n) => n + 1);
      },
      newEvents,
      stale,
      markCaughtUp: () => {
        setNewEvents([]);
        setStale(false);
      },
    }),
    [status, paused, newEvents, stale],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
