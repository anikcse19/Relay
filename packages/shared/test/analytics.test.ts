import { describe, expect, it } from 'vitest';
import {
  analyticsWindow,
  emptyHistogram,
  histogramPercentile,
  LATENCY_BOUNDS_MS,
  LATENCY_BUCKETS,
  latencyBucket,
  mergeHistogram,
} from '../src/analytics.js';
import { idAt, idTimestamp, newId } from '../src/ids.js';

const histogramOf = (durations: number[]) => {
  const h = emptyHistogram();
  for (const ms of durations) h[latencyBucket(ms)]!++;
  return h;
};

describe('latency histogram', () => {
  it('has strictly increasing bounds', () => {
    for (let i = 1; i < LATENCY_BOUNDS_MS.length; i++) {
      expect(LATENCY_BOUNDS_MS[i]!).toBeGreaterThan(LATENCY_BOUNDS_MS[i - 1]!);
    }
    expect(LATENCY_BUCKETS).toBe(LATENCY_BOUNDS_MS.length + 1);
  });

  it('buckets like width_bucket: lower bound inclusive, open-ended top', () => {
    expect(latencyBucket(0)).toBe(0);
    expect(latencyBucket(1)).toBe(1);
    expect(latencyBucket(99)).toBe(LATENCY_BOUNDS_MS.indexOf(80) + 1);
    expect(latencyBucket(100)).toBe(LATENCY_BOUNDS_MS.indexOf(100) + 1);
    expect(latencyBucket(10_000_000)).toBe(LATENCY_BUCKETS - 1);
  });

  it('estimates percentiles within the bucket width', () => {
    const durations = Array.from({ length: 1_000 }, (_, i) => 20 + i); // 20…1019 ms
    const h = histogramOf(durations);
    const exact = (q: number) => durations[Math.ceil(q * durations.length) - 1]!;
    for (const q of [0.5, 0.95, 0.99]) {
      const estimate = histogramPercentile(h, q)!;
      expect(Math.abs(estimate - exact(q)) / exact(q)).toBeLessThan(0.1);
    }
  });

  it('merges element-wise, and is empty-safe', () => {
    expect(histogramPercentile(emptyHistogram(), 0.5)).toBeNull();
    const merged = mergeHistogram(histogramOf([10, 10]), histogramOf([5_000]));
    expect(merged.reduce((a, b) => a + b)).toBe(3);
    expect(histogramPercentile(merged, 0.99)).toBeGreaterThanOrEqual(5_000);
    expect(histogramPercentile(histogramOf([100_000]), 0.5)).toBe(60_000); // top bucket: its lower bound
  });
});

describe('analyticsWindow', () => {
  it('covers whole UTC buckets, the last one containing now', () => {
    const now = Date.UTC(2026, 10, 12, 15, 42);
    const w = analyticsWindow('24h', now);
    expect(new Date(w.to).toISOString()).toBe('2026-11-12T16:00:00.000Z');
    expect(new Date(w.from).toISOString()).toBe('2026-11-11T16:00:00.000Z');
    const month = analyticsWindow('30d', now);
    expect((month.to - month.from) / month.bucketMs).toBe(30);
    expect(new Date(month.to).toISOString()).toBe('2026-11-13T00:00:00.000Z');
  });
});

describe('idAt', () => {
  it('sorts before every id created at or after that millisecond', () => {
    const ms = Date.now();
    const bound = idAt('event', ms);
    expect(idTimestamp(bound).getTime()).toBe(ms);
    expect(newId('event', ms) >= bound).toBe(true);
    expect(newId('event', ms - 1) < bound).toBe(true);
  });
});
