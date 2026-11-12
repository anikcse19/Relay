import type { Route } from 'next';
import type { AnalyticsRange, DeliveryStatus } from '@/lib/types';

/** Shared by the server page and client components (so not in a 'use client' module). */
export const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

export interface AnalyticsQuery {
  range: AnalyticsRange;
  endpointId?: string;
}

type RawParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Reads `?range=&endpointId=`, falling back to the defaults for anything invalid. */
export function parseAnalyticsQuery(params: RawParams): AnalyticsQuery {
  const range = first(params.range);
  const endpointId = first(params.endpointId);
  return {
    range: RANGES.some((r) => r.value === range) ? (range as AnalyticsRange) : '24h',
    ...(endpointId && /^ep_[0-9A-Z]{26}$/.test(endpointId) && { endpointId }),
  };
}

export function analyticsQueryString(query: AnalyticsQuery): string {
  const params = new URLSearchParams({ range: query.range });
  if (query.endpointId) params.set('endpointId', query.endpointId);
  return params.toString();
}

/** The chart segments that map onto a delivery status filter on the events list. */
export type Outcome = 'succeeded' | 'retried' | 'failed';

/**
 * Drill-down (guidelines §4.5): the events list for one time bucket,
 * narrowed to the endpoint and outcome that was clicked. "Retried" has no
 * matching delivery status (those deliveries have moved on), so it drills
 * into the bucket without a status filter.
 */
export function drillDownHref(
  eventsPath: Route,
  bucket: { start: string; bucketMs: number },
  options: { endpointId?: string; outcome?: Outcome } = {},
): Route {
  const start = Date.parse(bucket.start);
  const params = new URLSearchParams({
    from: new Date(start).toISOString(),
    to: new Date(start + bucket.bucketMs).toISOString(),
  });
  if (options.endpointId) params.set('endpointId', options.endpointId);
  const status: DeliveryStatus | undefined =
    options.outcome === 'retried' ? undefined : options.outcome;
  if (status) params.set('status', status);
  return `${eventsPath}?${params.toString()}` as Route;
}

/** "42 ms", "1.2 s", "15 s"; "–" without data. */
export function formatMs(ms: number | null): string {
  if (ms === null) return '–';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const s = ms / 1_000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

/** "99.2%", "100%", "0%"; "–" without data. Never rounds a failure up to 100%. */
export function formatPercent(rate: number | null): string {
  if (rate === null) return '–';
  if (rate === 1) return '100%';
  const pct = Math.floor(rate * 1000) / 10;
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

/** 1,284 / 12.9K / 1.2M. */
export function formatCount(n: number): string {
  if (n < 10_000) return n.toLocaleString('en');
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Round axis ticks from 0 up to at least `max` (about `count` steps). */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}
