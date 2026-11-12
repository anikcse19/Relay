'use client';

import { ArrowUp, Filter, Loader2, Radio, RotateCw, Send, X } from 'lucide-react';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CopyableId } from '@/components/copyable-id';
import { RelativeTime } from '@/components/relative-time';
import { StatusBadge } from '@/components/status-badge';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { LiveIndicator } from '@/features/live/live-indicator';
import { useLive } from '@/features/live/live-provider';
import { unseenEvents } from '@/features/live/messages';
import type { DeliveryStatus, Environment, EventSummary, Page, Role } from '@/lib/types';
import { useEndpointList } from '@/features/endpoints/api';
import { formatTimeRange } from '@/lib/time';
import { useEvents, useSendTestEvent } from './api';
import { DeliveryInspector } from './delivery-inspector';
import { EventPanel } from './event-panel';
import {
  type EventFilters,
  FILTER_KEYS,
  hasFilters,
  parseEventFilters,
  sameFilters,
  searchParamsRecord,
} from './query';

const MANAGE_ROLES: Role[] = ['owner', 'admin'];
/** Order in which per-status counts are shown in a row. */
const COUNT_ORDER: DeliveryStatus[] = ['failed', 'retrying', 'pending', 'succeeded', 'cancelled'];

/**
 * Events list. Everything that defines the view lives in the URL
 * (guidelines §10): filters (`?type=`, plus `?from=&to=&endpointId=&status=`
 * from analytics drill-downs), `?event=` / `?delivery=` drawer selection, so
 * it's shareable and survives refresh and Back.
 */
export function EventsView({
  environment,
  role,
  endpointsHref,
  initialPage,
  initialFilters,
}: {
  environment: Environment;
  role: Role;
  endpointsHref: Route;
  initialPage: Page<EventSummary> | null;
  initialFilters: EventFilters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(
    () => parseEventFilters(searchParamsRecord(searchParams)),
    [searchParams],
  );
  const type = filters.type;
  // The live tail only applies to "everything from now on", optionally by type.
  const tailing = !filters.from && !filters.to && !filters.endpointId && !filters.status;
  const selectedEvent = searchParams.get('event');
  const selectedDelivery = searchParams.get('delivery');

  const events = useEvents(
    environment.id,
    filters,
    // Server-rendered page only matches the filters it was rendered with.
    sameFilters(filters, initialFilters) ? initialPage : null,
  );
  const sendTest = useSendTestEvent(environment.id);
  const canSend = MANAGE_ROLES.includes(role);
  const rows = useMemo(() => events.data?.pages.flatMap((p) => p.data) ?? [], [events.data]);

  // Live tail (guidelines §4.2): new events wait behind a pill instead of
  // pushing rows down under the reader; delivery counts update in place.
  const live = useLive();
  const unseen = useMemo(
    () =>
      tailing ? unseenEvents(live?.newEvents ?? [], new Set(rows.map((e) => e.id)), type) : [],
    [live?.newEvents, rows, type, tailing],
  );
  const showLatest = async () => {
    await events.refetch();
    live?.markCaughtUp();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // Nothing on screen to disturb: show new events straight away.
  const emptyWithNews = !events.isPending && rows.length === 0 && unseen.length > 0;
  useEffect(() => {
    if (emptyWithNews) void events.refetch();
  }, [emptyWithNews, events]);

  const clearFilters = Object.fromEntries(FILTER_KEYS.map((key) => [key, null]));

  function navigate(updates: Record<string, string | null>, mode: 'push' | 'replace' = 'push') {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router[mode]((query ? `${pathname}?${query}` : pathname) as Route, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Every event sent to {environment.name}, newest first, with how its deliveries are going.
            Select one to inspect its payload and each delivery attempt.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LiveIndicator />
          {canSend && (
            <Button
              variant="secondary"
              disabled={sendTest.isPending}
              onClick={async () => {
                const { id } = await sendTest.mutateAsync();
                navigate({ ...clearFilters, event: id, delivery: null });
              }}
            >
              {sendTest.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Send aria-hidden />
              )}
              Send test event
            </Button>
          )}
        </div>
      </div>

      {sendTest.error && (
        <ErrorAlert>Couldn&apos;t send the test event: {sendTest.error.message}</ErrorAlert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <TypeFilter
          value={type}
          onChange={(next) =>
            navigate({ type: next ?? null, event: null, delivery: null }, 'replace')
          }
        />
        <DrillDownChips
          environmentId={environment.id}
          filters={filters}
          onRemove={(keys) =>
            navigate(
              { ...Object.fromEntries(keys.map((k) => [k, null])), event: null, delivery: null },
              'replace',
            )
          }
        />
      </div>

      {(unseen.length > 0 || (tailing && live?.stale)) && rows.length > 0 && (
        <div className="sticky top-16 z-10 -mb-3 flex justify-center">
          <Button size="sm" className="rounded-full shadow-md" onClick={showLatest}>
            {unseen.length > 0 ? (
              <>
                <ArrowUp aria-hidden />
                {unseen.length >= 100 ? '99+' : unseen.length} new event
                {unseen.length === 1 ? '' : 's'}
              </>
            ) : (
              <>
                <RotateCw aria-hidden /> Show latest
              </>
            )}
          </Button>
        </div>
      )}

      {events.error ? (
        <ErrorAlert>Couldn&apos;t load events: {events.error.message}</ErrorAlert>
      ) : events.isPending ? (
        <p className="text-sm text-muted-foreground" aria-busy>
          Loading events…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          filtered={hasFilters(filters)}
          canSend={canSend}
          onClear={() => navigate(clearFilters, 'replace')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Deliveries</th>
                  <th className="px-4 py-2 font-medium">ID</th>
                  <th className="px-4 py-2 font-medium">Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr
                    key={event.id}
                    onClick={() => navigate({ event: event.id, delivery: null })}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/30 aria-selected:bg-muted/50"
                    aria-selected={event.id === selectedEvent}
                  >
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        className="font-mono text-xs font-medium hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate({ event: event.id, delivery: null });
                        }}
                      >
                        {event.type}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <DeliveryCounts counts={event.deliveryCounts} />
                    </td>
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <CopyableId value={event.id} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                      <RelativeTime value={event.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {events.hasNextPage && (
            <Button
              variant="secondary"
              className="self-center"
              disabled={events.isFetchingNextPage}
              onClick={() => events.fetchNextPage()}
            >
              {events.isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden />}
              Load older events
            </Button>
          )}
        </div>
      )}

      <Sheet
        open={selectedEvent !== null || selectedDelivery !== null}
        onOpenChange={(open) => !open && navigate({ event: null, delivery: null })}
      >
        <SheetContent aria-describedby={undefined}>
          {selectedDelivery ? (
            <DeliveryInspector
              environmentId={environment.id}
              deliveryId={selectedDelivery}
              canReplay={canSend}
              onBack={selectedEvent ? () => navigate({ delivery: null }) : undefined}
            />
          ) : selectedEvent ? (
            <EventPanel
              environmentId={environment.id}
              eventId={selectedEvent}
              endpointsHref={endpointsHref}
              onOpenDelivery={(id) => navigate({ delivery: id })}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DeliveryCounts({ counts }: { counts: Record<DeliveryStatus, number> }) {
  const shown = COUNT_ORDER.filter((s) => counts[s] > 0);
  if (shown.length === 0) {
    return <span className="text-xs text-muted-foreground">Not sent to any endpoint</span>;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {shown.map((status) => (
        <StatusBadge key={status} status={status} detail={String(counts[status])} />
      ))}
    </span>
  );
}

function Chip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 py-0.5 pl-3 pr-1 text-xs">
      {label}: {/* Times are formatted in the viewer's zone, which the server can't know. */}
      <span className="font-medium" suppressHydrationWarning>
        {value}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Remove filter: ${label} ${value}`}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: 'Pending',
  retrying: 'Retrying',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Chips for the filters an analytics drill-down applies (time range, endpoint, status). */
function DrillDownChips({
  environmentId,
  filters,
  onRemove,
}: {
  environmentId: string;
  filters: EventFilters;
  onRemove: (keys: (keyof EventFilters)[]) => void;
}) {
  const endpoints = useEndpointList(environmentId);
  const endpointUrl = endpoints.data?.find((e) => e.id === filters.endpointId)?.url;
  const chips = [
    (filters.from || filters.to) && (
      <Chip
        key="time"
        label="Created"
        value={formatTimeRange(filters.from, filters.to)}
        onRemove={() => onRemove(['from', 'to'])}
      />
    ),
    filters.endpointId && (
      <Chip
        key="endpoint"
        label="Endpoint"
        value={endpointUrl ? new URL(endpointUrl).host : filters.endpointId}
        onRemove={() => onRemove(['endpointId'])}
      />
    ),
    filters.status && (
      <Chip
        key="status"
        label="Delivery"
        value={STATUS_LABEL[filters.status]}
        onRemove={() => onRemove(['status'])}
      />
    ),
  ].filter(Boolean);
  if (chips.length === 0) return null;
  return (
    <>
      {chips}
      {chips.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onRemove(['from', 'to', 'endpointId', 'status'])}
        >
          Clear
        </Button>
      )}
    </>
  );
}

/** Filter chip (guidelines §4.1): applied filters show as removable chips. */
function TypeFilter({
  value,
  onChange,
}: {
  value?: string;
  onChange: (type: string | undefined) => void;
}) {
  const [draft, setDraft] = useState('');

  if (value) return <Chip label="Type" value={value} onRemove={() => onChange(undefined)} />;

  return (
    <form
      className="flex w-full max-w-sm items-center gap-2 sm:w-96"
      onSubmit={(e) => {
        e.preventDefault();
        const next = draft.trim();
        if (next) {
          onChange(next);
          setDraft('');
        }
      }}
    >
      <label htmlFor="type-filter" className="sr-only">
        Filter by event type
      </label>
      <div className="relative flex-1">
        <Filter
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="type-filter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Filter by type, e.g. invoice.paid"
          className="h-8 pl-8 font-mono text-xs"
        />
      </div>
      <Button type="submit" variant="secondary" size="sm" disabled={!draft.trim()}>
        Apply
      </Button>
    </form>
  );
}

function EmptyState({
  filtered,
  canSend,
  onClear,
}: {
  filtered: boolean;
  canSend: boolean;
  onClear: () => void;
}) {
  if (filtered) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">No events match these filters.</p>
        <Button variant="secondary" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Radio className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="font-semibold">No events yet</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Events appear here as soon as your server sends them with{' '}
        <span className="font-mono">POST /v1/events</span>.
        {canSend && ' Or send a test event from here to see the whole flow.'}
      </p>
    </div>
  );
}
