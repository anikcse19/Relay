'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api.client';
import { queryKeys } from '@/lib/query-keys';
import { useLive } from '@/features/live/live-provider';
import type { Notification, Page } from '@/lib/types';

type NotificationPage = Page<Notification> & { unreadCount: number };

const path = (environmentId: string) => `/v1/environments/${environmentId}/notifications` as const;

/**
 * Latest alerts + unread count. Pushed by the live stream (ADR-0016); polled
 * every 30 s only as a fallback while the stream isn't connected.
 */
export function useNotifications(environmentId: string) {
  const live = useLive()?.status === 'live';
  return useQuery({
    queryKey: queryKeys.notifications.list(environmentId),
    queryFn: () => apiFetch<NotificationPage>(`${path(environmentId)}?limit=20`),
    refetchInterval: live ? false : 30_000,
  });
}

/** Optimistic: the badge drops immediately; re-synced from the server afterwards. */
export function useMarkRead(environmentId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.notifications.list(environmentId);
  return useMutation({
    mutationFn: (ids?: string[]) =>
      apiFetch<{ updated: number }>(`${path(environmentId)}/read`, {
        method: 'POST',
        body: JSON.stringify(ids ? { ids } : {}),
      }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationPage>(key);
      if (previous) {
        const now = new Date().toISOString();
        const marks = (n: Notification) => !n.readAt && (!ids || ids.includes(n.id));
        queryClient.setQueryData<NotificationPage>(key, {
          ...previous,
          unreadCount: Math.max(0, previous.unreadCount - previous.data.filter(marks).length),
          data: previous.data.map((n) => (marks(n) ? { ...n, readAt: now } : n)),
        });
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
