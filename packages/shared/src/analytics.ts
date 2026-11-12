/**
 * Delivery analytics (ADR-0017): latency is stored as a fixed histogram per
 * endpoint per hour, so percentiles can be merged across any hours and
 * endpoints (percentiles themselves can't be averaged).
 *
 * Bucket `i` (0-based) holds durations in `[LATENCY_BOUNDS_MS[i-1], LATENCY_BOUNDS_MS[i])`;
 * bucket 0 starts at 0 and the last bucket is open-ended. This matches
 * Postgres `width_bucket(ms, bounds)` (which returns `i`), so SQL and
 * TypeScript agree. Steps grow by ≤ 33 % from 10 ms, which bounds the
 * percentile error. **Never change these bounds:** stored histograms
 * depend on them (add a new column instead).
 */
export const LATENCY_BOUNDS_MS = [
  1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400,
  500, 600, 800, 1_000, 1_200, 1_500, 2_000, 2_500, 3_000, 4_000, 5_000, 6_000, 8_000, 10_000,
  12_000, 15_000, 20_000, 25_000, 30_000, 40_000, 60_000,
] as const;

/** One more bucket than bounds: the open-ended top bucket. */
export const LATENCY_BUCKETS = LATENCY_BOUNDS_MS.length + 1;

/** The histogram bucket (0-based) for a duration; same as SQL `width_bucket(ms, bounds)`. */
export function latencyBucket(ms: number): number {
  let lo = 0;
  let hi: number = LATENCY_BOUNDS_MS.length;
  // Number of bounds <= ms (binary search).
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (LATENCY_BOUNDS_MS[mid]! <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function emptyHistogram(): number[] {
  return new Array<number>(LATENCY_BUCKETS).fill(0);
}

/** Adds `from` into `into`, element-wise. */
export function mergeHistogram(into: number[], from: readonly number[]): number[] {
  for (let i = 0; i < into.length; i++) into[i]! += from[i] ?? 0;
  return into;
}

/**
 * Estimates the `q` quantile (0–1) from a histogram, interpolating linearly
 * inside the bucket that holds it. `null` when the histogram is empty. The
 * open-ended top bucket reports its lower bound.
 */
export function histogramPercentile(histogram: readonly number[], q: number): number | null {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rank = Math.min(Math.max(q, 0), 1) * total;
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    const n = histogram[i]!;
    if (n === 0) continue;
    if (seen + n >= rank) {
      const lower = i === 0 ? 0 : LATENCY_BOUNDS_MS[i - 1]!;
      const upper = LATENCY_BOUNDS_MS[i];
      if (upper === undefined) return lower;
      return Math.round(lower + ((rank - seen) / n) * (upper - lower));
    }
    seen += n;
  }
  return LATENCY_BOUNDS_MS.at(-1)!;
}

/** What one attempt counts as in the rollup. */
export type AttemptOutcome = 'succeeded' | 'retried' | 'failed';

export const ANALYTICS_RANGES = {
  '24h': { buckets: 24, bucketMs: 3_600_000 },
  '7d': { buckets: 28, bucketMs: 6 * 3_600_000 },
  '30d': { buckets: 30, bucketMs: 24 * 3_600_000 },
} as const;

export type AnalyticsRange = keyof typeof ANALYTICS_RANGES;

/**
 * Bucket boundaries for a range ending now: whole UTC buckets, the last one
 * containing `now` (so it's still filling up).
 */
export function analyticsWindow(range: AnalyticsRange, now = Date.now()) {
  const { buckets, bucketMs } = ANALYTICS_RANGES[range];
  const to = Math.floor(now / bucketMs) * bucketMs + bucketMs;
  return { from: to - buckets * bucketMs, to, bucketMs, buckets };
}
