import { Inject, Injectable } from '@nestjs/common';
import { type Database, endpoints, eq, sql } from '@relay/db';
import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  analyticsWindow,
  emptyHistogram,
  histogramPercentile,
} from '@relay/shared';
import { z } from 'zod';
import { DB } from '../database/database.module.js';
import type { Tenant } from '../tenancy/tenant.guard.js';

export const analyticsQuerySchema = z.object({
  range: z
    .enum(Object.keys(ANALYTICS_RANGES) as [AnalyticsRange, ...AnalyticsRange[]])
    .default('24h')
    .describe('24h (hourly buckets), 7d (6-hour buckets) or 30d (daily buckets), in UTC'),
  endpointId: z
    .string()
    .regex(/^ep_[0-9A-Z]{26}$/, 'must be an endpoint id')
    .optional()
    .describe('Only this endpoint'),
});

export interface DeliveryStats {
  /** Every attempt counts as exactly one of succeeded / retried / failed. */
  attempts: number;
  succeeded: number;
  /** Failed attempts that scheduled a retry. */
  retried: number;
  /** Failed attempts with no retry left. */
  failed: number;
  /** succeeded / attempts; `null` without attempts. */
  successRate: number | null;
  /** Latency percentiles (ms) of attempts that got a response; `null` without any. */
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface Analytics {
  range: AnalyticsRange;
  from: string;
  to: string;
  bucketMs: number;
  totals: DeliveryStats;
  /** One entry per bucket, oldest first, zero-filled. */
  series: (DeliveryStats & { start: string })[];
  /** Endpoints with attempts in the range, most failures first. */
  endpoints: (DeliveryStats & { endpointId: string; url: string })[];
}

interface Acc {
  succeeded: number;
  retried: number;
  failed: number;
  histogram: number[];
}

const emptyAcc = (): Acc => ({ succeeded: 0, retried: 0, failed: 0, histogram: emptyHistogram() });

function finish(acc: Acc): DeliveryStats {
  const attempts = acc.succeeded + acc.retried + acc.failed;
  return {
    attempts,
    succeeded: acc.succeeded,
    retried: acc.retried,
    failed: acc.failed,
    successRate: attempts === 0 ? null : acc.succeeded / attempts,
    p50: histogramPercentile(acc.histogram, 0.5),
    p95: histogramPercentile(acc.histogram, 0.95),
    p99: histogramPercentile(acc.histogram, 0.99),
  };
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

/**
 * Reads the hourly rollup (ADR-0017). Counts and latency histograms are
 * summed per (bucket, endpoint) in SQL, then folded into the time series,
 * the per-endpoint table and the totals here; percentiles are computed from
 * the merged histograms, never averaged.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(tenant: Tenant, query: z.infer<typeof analyticsQuerySchema>): Promise<Analytics> {
    const window = analyticsWindow(query.range);
    const from = new Date(window.from);
    const to = new Date(window.to);
    const bucket = sql`date_bin(make_interval(secs => ${window.bucketMs / 1000}), s.hour, timestamptz '1970-01-01 00:00:00+00')`;
    const scope = sql`s.environment_id = ${tenant.environmentId}
      and s.hour >= ${from.toISOString()}::timestamptz and s.hour < ${to.toISOString()}::timestamptz
      ${query.endpointId ? sql`and s.endpoint_id = ${query.endpointId}` : sql``}`;

    const [counts, latency, urls] = await Promise.all([
      this.db.execute(sql`
        select (extract(epoch from ${bucket}) * 1000)::float8 as bucket_ms, s.endpoint_id,
               sum(s.succeeded)::int as succeeded, sum(s.retried)::int as retried,
               sum(s.failed)::int as failed
          from delivery_stats_hourly s
         where ${scope}
         group by 1, 2`),
      this.db.execute(sql`
        select (extract(epoch from ${bucket}) * 1000)::float8 as bucket_ms, s.endpoint_id,
               (h.i - 1)::int as idx, sum(h.n)::int as n
          from delivery_stats_hourly s
         cross join lateral unnest(s.latency_histogram) with ordinality as h(n, i)
         where ${scope} and h.n > 0
         group by 1, 2, 3`),
      this.db
        .select({ id: endpoints.id, url: endpoints.url })
        .from(endpoints)
        .where(eq(endpoints.environmentId, tenant.environmentId)),
    ]);

    const byBucket = new Map<number, Acc>();
    const byEndpoint = new Map<string, Acc>();
    const total = emptyAcc();
    const accIn = <K>(map: Map<K, Acc>, key: K) => {
      let acc = map.get(key);
      if (!acc) map.set(key, (acc = emptyAcc()));
      return acc;
    };

    type CountRow = {
      bucket_ms: number;
      endpoint_id: string;
      succeeded: number;
      retried: number;
      failed: number;
    };
    for (const row of rowsOf<CountRow>(counts)) {
      for (const acc of [
        accIn(byBucket, Number(row.bucket_ms)),
        accIn(byEndpoint, row.endpoint_id),
        total,
      ]) {
        acc.succeeded += row.succeeded;
        acc.retried += row.retried;
        acc.failed += row.failed;
      }
    }
    type LatencyRow = { bucket_ms: number; endpoint_id: string; idx: number; n: number };
    for (const row of rowsOf<LatencyRow>(latency)) {
      for (const acc of [
        accIn(byBucket, Number(row.bucket_ms)),
        accIn(byEndpoint, row.endpoint_id),
        total,
      ]) {
        acc.histogram[row.idx]! += row.n;
      }
    }

    const urlOf = new Map(urls.map((e) => [e.id, e.url]));
    return {
      range: query.range,
      from: from.toISOString(),
      to: to.toISOString(),
      bucketMs: window.bucketMs,
      totals: finish(total),
      series: Array.from({ length: window.buckets }, (_, i) => {
        const start = window.from + i * window.bucketMs;
        return {
          start: new Date(start).toISOString(),
          ...finish(byBucket.get(start) ?? emptyAcc()),
        };
      }),
      endpoints: [...byEndpoint]
        .map(([endpointId, acc]) => ({
          endpointId,
          url: urlOf.get(endpointId) ?? '',
          ...finish(acc),
        }))
        .sort((a, b) => b.failed - a.failed || b.attempts - a.attempts),
    };
  }
}
