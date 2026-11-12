import type { DeliveryStatus, EventSummary, Page } from '@/lib/types';

/** Mirrors `LiveMessage` in @relay/db (ADR-0016). */
export type LiveMessage =
  | { type: 'event.created'; environmentId: string; event: EventSummary }
  | {
      type: 'delivery.updated';
      environmentId: string;
      deliveryId: string;
      eventId: string;
      from: DeliveryStatus;
      to: DeliveryStatus;
      attemptCount: number;
    }
  | { type: 'notification.created'; environmentId: string; notificationId: string };

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'paused';

/** Moves one delivery between status buckets, never below zero. Pure (tested). */
export function applyStatusChange(
  event: EventSummary,
  from: DeliveryStatus,
  to: DeliveryStatus,
): EventSummary {
  if (from === to) return event;
  return {
    ...event,
    deliveryCounts: {
      ...event.deliveryCounts,
      [from]: Math.max(0, event.deliveryCounts[from] - 1),
      [to]: event.deliveryCounts[to] + 1,
    },
  };
}

/** Applies a delivery change to every page of a cached events list, in place (no reordering). */
export function patchEventPages(
  data: { pages: Page<EventSummary>[]; pageParams: unknown[] } | undefined,
  eventId: string,
  from: DeliveryStatus,
  to: DeliveryStatus,
) {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => ({
    ...page,
    data: page.data.map((e) => {
      if (e.id !== eventId) return e;
      changed = true;
      return applyStatusChange(e, from, to);
    }),
  }));
  return changed ? { ...data, pages } : data;
}

/** New events not yet in the visible list, matching its filter: the "↑ N new" pill. */
export function unseenEvents(
  buffered: EventSummary[],
  visibleIds: ReadonlySet<string>,
  typeFilter?: string,
): EventSummary[] {
  return buffered.filter((e) => !visibleIds.has(e.id) && (!typeFilter || e.type === typeFilter));
}
