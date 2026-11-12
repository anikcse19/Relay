'use client';

import { ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { CodeBlock } from '@/components/code-block';
import { CopyableId } from '@/components/copyable-id';
import { RelativeTime } from '@/components/relative-time';
import { StatusBadge } from '@/components/status-badge';
import { ErrorAlert } from '@/components/ui/alert';
import { SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useEvent } from './api';

/** Event detail in the drawer: payload, then one row per endpoint it was sent to. */
export function EventPanel({
  environmentId,
  eventId,
  endpointsHref,
  onOpenDelivery,
}: {
  environmentId: string;
  eventId: string;
  endpointsHref: Route;
  onOpenDelivery: (deliveryId: string) => void;
}) {
  const { data: event, error, isPending } = useEvent(environmentId, eventId);

  if (isPending) {
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy>
        <SheetTitle className="sr-only">Loading event…</SheetTitle>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <SheetTitle className="text-lg font-semibold">Event</SheetTitle>
        <ErrorAlert>Couldn&apos;t load this event: {error.message}</ErrorAlert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1 pr-8">
        <SheetTitle className="font-mono text-lg font-semibold">{event.type}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <CopyableId value={event.id} />
            <span>
              Received <RelativeTime value={event.createdAt} />
            </span>
            {event.idempotencyKey && (
              <span>
                Idempotency key <span className="font-mono">{event.idempotencyKey}</span>
              </span>
            )}
          </div>
        </SheetDescription>
      </div>

      <section aria-labelledby="deliveries-heading" className="flex flex-col gap-2">
        <h3 id="deliveries-heading" className="text-sm font-medium">
          Deliveries
        </h3>
        {event.deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No endpoint was subscribed to <span className="font-mono">{event.type}</span> when this
            event arrived, so it wasn&apos;t sent anywhere.{' '}
            <Link href={endpointsHref} className="text-primary hover:underline">
              Add an endpoint
            </Link>{' '}
            and send another event.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {event.deliveries.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onOpenDelivery(d.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50"
                >
                  <StatusBadge
                    status={d.status}
                    detail={d.attemptCount > 1 ? `${d.attemptCount} attempts` : undefined}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={d.endpointUrl}>
                    {d.endpointUrl}
                  </span>
                  {d.lastStatusCode !== null && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {d.lastStatusCode}
                    </span>
                  )}
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  <span className="sr-only">Inspect delivery</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="payload-heading" className="flex flex-col gap-2">
        <h3 id="payload-heading" className="text-sm font-medium">
          Payload
        </h3>
        <CodeBlock value={JSON.stringify(event.data, null, 2)} label="Event payload" />
      </section>
    </div>
  );
}
