'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api.client';
import { queryKeys } from '@/lib/query-keys';
import type { DeliveryDetail, EventDetail, EventSummary, Page } from '@/lib/types';
import { useLive } from '@/features/live/live-provider';
import { type EventFilters, eventsQueryString } from './query';

const envPath = (environmentId: string) => `/v1/environments/${environmentId}` as const;

/**
 * Fallback polling while something is in flight. Only used when the live
 * stream isn't connected (paused, reconnecting, offline): live messages
 * update the cache otherwise (ADR-0016).
 */
const IN_FLIGHT_POLL_MS = 2_000;

function usePollingFallback(): boolean {
  return useLive()?.status !== 'live';
}

const inFlight = (e: EventSummary) => e.deliveryCounts.pending + e.deliveryCounts.retrying > 0;

/**
 * Cursor-paginated events ("Load more"). The first page is server-rendered;
 * it seeds the cache only for the filters it was rendered with.
 */
export function useEvents(
  environmentId: string,
  filters: EventFilters,
  initialPage: Page<EventSummary> | null,
) {
  const poll = usePollingFallback();
  return useInfiniteQuery({
    queryKey: queryKeys.events.list(environmentId, filters),
    queryFn: ({ pageParam }) =>
      apiFetch<Page<EventSummary>>(
        `${envPath(environmentId)}/events?${eventsQueryString(filters, pageParam)}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...(initialPage && { initialData: { pages: [initialPage], pageParams: [undefined] } }),
    // Keep delivery counts fresh while the newest events are still being delivered.
    refetchInterval: (query) =>
      poll && query.state.data?.pages[0]?.data.some(inFlight) ? IN_FLIGHT_POLL_MS : false,
  });
}

export function useEvent(environmentId: string, id: string | null) {
  const poll = usePollingFallback();
  return useQuery({
    queryKey: queryKeys.events.detail(environmentId, id ?? ''),
    queryFn: () => apiFetch<EventDetail>(`${envPath(environmentId)}/events/${id}`),
    enabled: id !== null,
    refetchInterval: (query) =>
      poll &&
      query.state.data?.deliveries.some((d) => d.status === 'pending' || d.status === 'retrying')
        ? IN_FLIGHT_POLL_MS
        : false,
  });
}

export function useDelivery(environmentId: string, id: string | null) {
  const poll = usePollingFallback();
  return useQuery({
    queryKey: queryKeys.deliveries.detail(environmentId, id ?? ''),
    queryFn: () => apiFetch<DeliveryDetail>(`${envPath(environmentId)}/deliveries/${id}`),
    enabled: id !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return poll && (status === 'pending' || status === 'retrying') ? IN_FLIGHT_POLL_MS : false;
    },
  });
}

/** Dashboard "Send test event": a real event through the same pipeline as the API. */
export function useSendTestEvent(environmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>(`${envPath(environmentId)}/events`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'relay.test',
          data: { message: 'Hello from Relay! This is a test event.', sentFrom: 'dashboard' },
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all(environmentId) }),
  });
}

/**
 * Replays a finished delivery (one manual attempt). The inspector switches
 * to the returned "pending" state at once, then polls until the attempt lands.
 */
export function useReplayDelivery(environmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<DeliveryDetail>(`${envPath(environmentId)}/deliveries/${id}/replay`, {
        method: 'POST',
      }),
    onSuccess: (delivery) => {
      queryClient.setQueryData(queryKeys.deliveries.detail(environmentId, delivery.id), delivery);
      void queryClient.invalidateQueries({ queryKey: queryKeys.events.all(environmentId) });
    },
  });
}
