'use client';

import { ArrowLeft, Info } from 'lucide-react';
import { useState } from 'react';
import { CodeBlock, HeaderList } from '@/components/code-block';
import { CopyableId } from '@/components/copyable-id';
import { RelativeTime } from '@/components/relative-time';
import { StatusBadge } from '@/components/status-badge';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DeliveryAttempt, DeliveryDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useDelivery } from './api';
import {
  attemptLabel,
  attemptSucceeded,
  deliverySummary,
  explainAttempt,
  formatDelta,
  formatDuration,
  prettyJson,
} from './explain';

/**
 * The delivery inspector (guidelines §4.3), the most important screen:
 * status, a timeline of attempts with the gaps between them, and the exact
 * request and response of the selected attempt, with failures explained.
 */
export function DeliveryInspector({
  environmentId,
  deliveryId,
  onBack,
}: {
  environmentId: string;
  deliveryId: string;
  /** Shown when opened from an event: back to that event. */
  onBack?: () => void;
}) {
  const { data: delivery, error, isPending } = useDelivery(environmentId, deliveryId);

  return (
    <div className="flex flex-col gap-5 p-6">
      {onBack && (
        <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}>
          <ArrowLeft aria-hidden /> Back to event
        </Button>
      )}
      {isPending ? (
        <InspectorSkeleton />
      ) : error ? (
        <>
          <SheetTitle className="text-lg font-semibold">Delivery</SheetTitle>
          <ErrorAlert>Couldn&apos;t load this delivery: {error.message}</ErrorAlert>
        </>
      ) : (
        <InspectorBody delivery={delivery} />
      )}
    </div>
  );
}

function InspectorBody({ delivery }: { delivery: DeliveryDetail }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const attempts = delivery.attempts;
  const selected = attempts.find((a) => a.id === selectedId) ?? attempts.at(-1);
  const explanation = selected ? explainAttempt(selected) : null;

  return (
    <>
      <div className="flex flex-col gap-1 pr-8">
        <SheetTitle className="flex flex-wrap items-center gap-x-2 text-lg font-semibold">
          <span className="font-mono">{delivery.eventType}</span>
          <span className="text-muted-foreground" aria-label="to">
            →
          </span>
          <span className="break-all font-mono text-sm font-normal">{delivery.endpointUrl}</span>
        </SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <CopyableId value={delivery.id} />
            <span>
              Event <CopyableId value={delivery.eventId} />
            </span>
          </div>
        </SheetDescription>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-4 py-3 text-sm">
        <StatusBadge status={delivery.status} />
        <span>{deliverySummary(delivery.status, delivery.attemptCount)}</span>
        {delivery.status === 'retrying' && delivery.nextAttemptAt && (
          <span className="text-muted-foreground">
            Next attempt <RelativeTime value={delivery.nextAttemptAt} />
          </span>
        )}
      </div>

      {attempts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No attempts yet. The worker picks up new deliveries within a few seconds; if the endpoint
          is paused, deliveries wait until it&apos;s resumed.
        </p>
      ) : (
        <>
          <section aria-labelledby="timeline-heading" className="flex flex-col gap-2">
            <h3 id="timeline-heading" className="text-sm font-medium">
              Timeline
            </h3>
            <ol className="flex flex-col">
              {attempts.map((attempt, i) => (
                <TimelineRow
                  key={attempt.id}
                  attempt={attempt}
                  previous={attempts[i - 1]}
                  selected={attempt.id === selected?.id}
                  onSelect={() => setSelectedId(attempt.id)}
                />
              ))}
            </ol>
          </section>

          {explanation && (
            <div
              role="note"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
            >
              <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div>
                <p className="font-medium">{explanation.title}</p>
                <p className="text-muted-foreground">{explanation.detail}</p>
                {selected?.errorMessage && (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {selected.errorMessage}
                  </p>
                )}
              </div>
            </div>
          )}

          {selected && <AttemptTabs delivery={delivery} attempt={selected} />}
        </>
      )}
    </>
  );
}

function TimelineRow({
  attempt,
  previous,
  selected,
  onSelect,
}: {
  attempt: DeliveryAttempt;
  previous?: DeliveryAttempt;
  selected: boolean;
  onSelect: () => void;
}) {
  const ok = attemptSucceeded(attempt);
  const time = new Date(attempt.createdAt);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'grid w-full grid-cols-[1.5rem_2rem_6rem_6rem_1fr] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm tabular-nums transition-colors hover:bg-muted/60',
          selected && 'bg-muted',
        )}
      >
        <span
          aria-hidden
          className={cn('mx-auto size-2.5 rounded-full', ok ? 'bg-success' : 'bg-danger')}
        />
        <span className="text-muted-foreground">#{attempt.attemptNumber}</span>
        <span title={time.toISOString()}>{time.toLocaleTimeString()}</span>
        <span className={cn('font-mono text-xs', ok ? 'text-success' : 'text-danger')}>
          {attemptLabel(attempt)}
          <span className="sr-only">{ok ? ' (succeeded)' : ' (failed)'}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {formatDuration(attempt.durationMs)}
          {previous && ` · ${formatDelta(time.getTime() - new Date(previous.createdAt).getTime())}`}
          {attempt.trigger === 'manual' && ' · manual replay'}
        </span>
      </button>
    </li>
  );
}

function AttemptTabs({
  delivery,
  attempt,
}: {
  delivery: DeliveryDetail;
  attempt: DeliveryAttempt;
}) {
  return (
    <Tabs defaultValue="response">
      <TabsList aria-label={`Attempt ${attempt.attemptNumber} details`}>
        <TabsTrigger value="response">Response</TabsTrigger>
        <TabsTrigger value="request">Request</TabsTrigger>
      </TabsList>
      <TabsContent value="response" className="flex flex-col gap-3">
        {attempt.statusCode === null ? (
          <p className="text-sm text-muted-foreground">
            No HTTP response was received for attempt #{attempt.attemptNumber}.
          </p>
        ) : (
          <>
            <p className="text-sm">
              HTTP <span className="font-mono">{attempt.statusCode}</span> in{' '}
              {formatDuration(attempt.durationMs)}
            </p>
            <HeaderList headers={attempt.responseHeaders} />
            {attempt.responseBody ? (
              <CodeBlock value={prettyJson(attempt.responseBody)} label="Response body" />
            ) : (
              <p className="text-sm text-muted-foreground">Empty response body.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Relay stores the first 4 KB of each response body.
            </p>
          </>
        )}
      </TabsContent>
      <TabsContent value="request" className="flex flex-col gap-3">
        <p className="break-all text-sm">
          <span className="font-mono">POST</span>{' '}
          <span className="font-mono">{delivery.endpointUrl}</span>
        </p>
        <HeaderList headers={attempt.requestHeaders} />
        <CodeBlock value={prettyJson(delivery.requestBody)} label="Request body" />
        <p className="text-xs text-muted-foreground">
          Values of your custom headers are redacted. The body is identical on every attempt, so
          receivers can deduplicate on <span className="font-mono">webhook-id</span>.
        </p>
      </TabsContent>
    </Tabs>
  );
}

function InspectorSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <SheetTitle className="sr-only">Loading delivery…</SheetTitle>
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
