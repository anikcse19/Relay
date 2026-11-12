'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api.client';
import { queryKeys } from '@/lib/query-keys';
import type { Notification, Page } from '@/lib/types';

type NotificationPage = Page<Notification> & { unreadCount: number };

const path = (environmentId: string) => `/v1/environments/${environmentId}/notifications` as const;

/**
 * Latest alerts + unread count. Polled every 30 s while the tab is visible
 * (TanStack pauses intervals in background tabs); Phase 3 replaces this
 * with a push over the live-tail WebSocket.
 */
export function useNotifications(environmentId: string) {
  return useQuery({
    queryKey: queryKeys.notifications.list(environmentId),
    queryFn: () => apiFetch<NotificationPage>(`${path(environmentId)}?limit=20`),
    refetchInterval: 30_000,
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
