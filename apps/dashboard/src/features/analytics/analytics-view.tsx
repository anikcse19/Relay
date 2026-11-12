'use client';

import { BarChart3, Loader2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useEndpointList } from '@/features/endpoints/api';
import type { Analytics, DeliveryStats, Environment } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAnalytics } from './api';
import {
  ChartCard,
  type LegendItem,
  LineChart,
  SeriesTable,
  StackedColumns,
  type StackSegment,
} from './charts';
import {
  type AnalyticsQuery,
  drillDownHref,
  formatCount,
  formatMs,
  formatPercent,
  type Outcome,
  parseAnalyticsQuery,
  RANGES,
} from './query';

const OUTCOMES: StackSegment<Outcome>[] = [
  { key: 'succeeded', label: 'Succeeded', color: 'var(--chart-succeeded)' },
  { key: 'retried', label: 'Failed, retried', color: 'var(--chart-retried)' },
  { key: 'failed', label: 'Failed, final', color: 'var(--chart-failed)' },
];
const OUTCOME_LEGEND: LegendItem[] = OUTCOMES.map((o) => ({ ...o, shape: 'rect' }));

const PERCENTILES = [
  { key: 'p50', label: 'p50', color: 'var(--chart-p50)' },
  { key: 'p95', label: 'p95', color: 'var(--chart-p95)' },
  { key: 'p99', label: 'p99', color: 'var(--chart-p99)' },
] as const;

/**
 * Delivery analytics (guidelines §4.5): success rate, outcomes and latency
 * over time, plus a per-endpoint breakdown. Filters live in the URL; every
 * chart drills into the events list for the bucket that was clicked.
 */
export function AnalyticsView({
  environment,
  eventsPath,
  initialQuery,
  initialData,
}: {
  environment: Environment;
  eventsPath: Route;
  initialQuery: AnalyticsQuery;
  initialData: Analytics | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(
    () =>
      parseAnalyticsQuery({
        range: searchParams.get('range') ?? undefined,
        endpointId: searchParams.get('endpointId') ?? undefined,
      }),
    [searchParams],
  );
  const sameAsInitial =
    query.range === initialQuery.range && query.endpointId === initialQuery.endpointId;
  const analytics = useAnalytics(environment.id, query, sameAsInitial ? initialData : null);
  const endpoints = useEndpointList(environment.id);
  const data = analytics.data;

  const setQuery = (next: AnalyticsQuery) => {
    const params = new URLSearchParams({ range: next.range });
    if (next.endpointId) params.set('endpointId', next.endpointId);
    router.replace(`${pathname}?${params.toString()}` as Route, { scroll: false });
  };

  const drill = (index: number, outcome?: Outcome) => {
    if (!data) return;
    router.push(
      drillDownHref(
        eventsPath,
        { start: data.series[index]!.start, bucketMs: data.bucketMs },
        { endpointId: query.endpointId, outcome },
      ),
    );
  };

  const rangeLabel = RANGES.find((r) => r.value === query.range)!.label.toLowerCase();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          How deliveries in {environment.name} are going: success rate, outcomes and response time.
          Select any bar or point to see the events behind it.
        </p>
      </div>

      {/* One filter row above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Time range" className="flex rounded-md border p-0.5 text-sm">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={query.range === r.value}
              onClick={() => setQuery({ ...query, range: r.value })}
              className={cn(
                'rounded-sm px-2.5 py-1 text-muted-foreground',
                query.range === r.value && 'bg-muted font-medium text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="endpoint-filter">
          Endpoint
        </label>
        <select
          id="endpoint-filter"
          value={query.endpointId ?? ''}
          onChange={(e) => setQuery({ ...query, endpointId: e.target.value || undefined })}
          className="h-8 max-w-xs rounded-md border bg-background px-2 text-sm"
        >
          <option value="">All endpoints</option>
          {endpoints.data?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.url}
            </option>
          ))}
        </select>
        {analytics.isFetching && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />
        )}
        <p className="ml-auto text-xs text-muted-foreground">Times in your time zone</p>
      </div>

      {analytics.error && !data ? (
        <ErrorAlert>
          Couldn&apos;t load analytics: {analytics.error.message}{' '}
          <Button variant="secondary" size="sm" onClick={() => analytics.refetch()}>
            Retry
          </Button>
        </ErrorAlert>
      ) : !data ? (
        <p className="text-sm text-muted-foreground" aria-busy>
          Loading analytics…
        </p>
      ) : data.totals.attempts === 0 ? (
        <EmptyState rangeLabel={rangeLabel} filtered={!!query.endpointId} eventsPath={eventsPath} />
      ) : (
        // Refetch keeps the frame: the previous numbers stay, dimmed, until new ones arrive.
        <div
          className={cn(
            'flex flex-col gap-6 transition-opacity',
            analytics.isPlaceholderData && 'opacity-60',
          )}
        >
          <StatTiles totals={data.totals} />

          <ChartCard
            title="Delivery attempts"
            description="Every attempt by outcome. A failed attempt is retried until retries run out."
            legend={OUTCOME_LEGEND}
            table={
              <SeriesTable
                buckets={data.series}
                columns={[
                  ...OUTCOMES.map((o) => ({
                    label: o.label,
                    value: (b: DeliveryStats) => formatCount(b[o.key]),
                  })),
                  { label: 'Total', value: (b: DeliveryStats) => formatCount(b.attempts) },
                ]}
              />
            }
          >
            <StackedColumns
              label="Delivery attempts by outcome"
              buckets={data.series}
              bucketMs={data.bucketMs}
              range={data.range}
              segments={OUTCOMES}
              formatValue={formatCount}
              onDrill={drill}
            />
          </ChartCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="Success rate"
              description="Share of attempts that got a 2xx response."
              legend={[]}
              table={
                <SeriesTable
                  buckets={data.series}
                  columns={[
                    { label: 'Success rate', value: (b) => formatPercent(b.successRate) },
                    { label: 'Attempts', value: (b) => formatCount(b.attempts) },
                  ]}
                />
              }
            >
              <LineChart
                label="Success rate over time"
                buckets={data.series}
                bucketMs={data.bucketMs}
                range={data.range}
                lines={[
                  {
                    key: 'rate',
                    label: 'success rate',
                    color: 'var(--chart-rate)',
                    values: data.series.map((b) => b.successRate),
                  },
                ]}
                yMax={1}
                formatValue={formatPercent}
                onDrill={drill}
              />
            </ChartCard>

            <ChartCard
              title="Response time"
              description="Latency percentiles of attempts that got a response."
              legend={PERCENTILES.map((p) => ({ ...p, shape: 'line' }))}
              table={
                <SeriesTable
                  buckets={data.series}
                  columns={PERCENTILES.map((p) => ({
                    label: p.label,
                    value: (b: DeliveryStats) => formatMs(b[p.key]),
                  }))}
                />
              }
            >
              <LineChart
                label="Response time percentiles over time"
                buckets={data.series}
                bucketMs={data.bucketMs}
                range={data.range}
                lines={PERCENTILES.map((p) => ({
                  ...p,
                  values: data.series.map((b) => b[p.key]),
                }))}
                formatValue={formatMs}
                onDrill={drill}
              />
            </ChartCard>
          </div>

          <EndpointTable
            rows={data.endpoints}
            selected={query.endpointId}
            onSelect={(endpointId) => setQuery({ ...query, endpointId })}
            eventsHref={(endpointId) =>
              `${eventsPath}?${new URLSearchParams({ from: data.from, to: data.to, endpointId })}` as Route
            }
          />
        </div>
      )}
    </div>
  );
}

function StatTiles({ totals }: { totals: DeliveryStats }) {
  const tiles = [
    { label: 'Success rate', value: formatPercent(totals.successRate) },
    { label: 'Attempts', value: formatCount(totals.attempts) },
    {
      label: 'Failed, final',
      value: formatCount(totals.failed),
      note: totals.retried > 0 ? `${formatCount(totals.retried)} more were retried` : undefined,
    },
    {
      label: 'p95 response time',
      value: formatMs(totals.p95),
      note: `p50 ${formatMs(totals.p50)} · p99 ${formatMs(totals.p99)}`,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border bg-card p-4">
          <dt className="text-xs text-muted-foreground">{tile.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight">{tile.value}</dd>
          {tile.note && <dd className="mt-0.5 text-xs text-muted-foreground">{tile.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function EndpointTable({
  rows,
  selected,
  onSelect,
  eventsHref,
}: {
  rows: Analytics['endpoints'];
  selected?: string;
  onSelect: (endpointId: string | undefined) => void;
  eventsHref: (endpointId: string) => Route;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">By endpoint</h2>
        <p className="text-xs text-muted-foreground">Most failures first.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Endpoint</th>
              <th className="px-4 py-2 text-right font-medium">Attempts</th>
              <th className="px-4 py-2 text-right font-medium">Success</th>
              <th className="px-4 py-2 text-right font-medium">Failed</th>
              <th className="px-4 py-2 text-right font-medium">p50</th>
              <th className="px-4 py-2 text-right font-medium">p95</th>
              <th className="px-4 py-2 text-right font-medium">p99</th>
              <th className="px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((row) => (
              <tr key={row.endpointId} className="border-b last:border-0">
                <td className="max-w-xs truncate px-4 py-2.5 font-mono text-xs" title={row.url}>
                  {row.url || row.endpointId}
                </td>
                <td className="px-4 py-2.5 text-right">{formatCount(row.attempts)}</td>
                <td className="px-4 py-2.5 text-right">{formatPercent(row.successRate)}</td>
                <td className={cn('px-4 py-2.5 text-right', row.failed > 0 && 'text-danger')}>
                  {formatCount(row.failed)}
                </td>
                <td className="px-4 py-2.5 text-right">{formatMs(row.p50)}</td>
                <td className="px-4 py-2.5 text-right">{formatMs(row.p95)}</td>
                <td className="px-4 py-2.5 text-right">{formatMs(row.p99)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs">
                  {selected === row.endpointId ? (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground hover:underline"
                      onClick={() => onSelect(undefined)}
                    >
                      Show all
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground hover:underline"
                      onClick={() => onSelect(row.endpointId)}
                    >
                      Focus
                    </button>
                  )}
                  <span className="mx-1.5 text-border">|</span>
                  <Link
                    href={eventsHref(row.endpointId)}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Events
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyState({
  rangeLabel,
  filtered,
  eventsPath,
}: {
  rangeLabel: string;
  filtered: boolean;
  eventsPath: Route;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <BarChart3 className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="font-semibold">No delivery attempts in the {rangeLabel}</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {filtered
          ? 'This endpoint had no deliveries in this period. Try a longer range or all endpoints.'
          : 'Charts fill in as Relay delivers events to your endpoints. Send a test event to see one arrive.'}
      </p>
      <Button asChild variant="secondary" size="sm">
        <Link href={eventsPath}>Go to events</Link>
      </Button>
    </div>
  );
}
