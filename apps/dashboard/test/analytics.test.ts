import type { Route } from 'next';
import { describe, expect, it } from 'vitest';
import {
  analyticsQueryString,
  drillDownHref,
  formatCount,
  formatMs,
  formatPercent,
  niceTicks,
  parseAnalyticsQuery,
} from '@/features/analytics/query';
import {
  eventsQueryString,
  hasFilters,
  parseEventFilters,
  sameFilters,
} from '@/features/events/query';
import { formatTimeRange } from '@/lib/time';

const EP = 'ep_01JD3X8Z5K2M4N6P8Q0R2S4T6V';

describe('analytics query', () => {
  it('parses the URL, falling back to defaults', () => {
    expect(parseAnalyticsQuery({})).toEqual({ range: '24h' });
    expect(parseAnalyticsQuery({ range: '7d', endpointId: EP })).toEqual({
      range: '7d',
      endpointId: EP,
    });
    expect(parseAnalyticsQuery({ range: '1y', endpointId: 'nope' })).toEqual({ range: '24h' });
    expect(analyticsQueryString({ range: '30d', endpointId: EP })).toBe(
      `range=30d&endpointId=${EP}`,
    );
  });

  it('drills a bucket into the events list, mapping outcomes onto delivery status', () => {
    const bucket = { start: '2026-11-12T14:00:00.000Z', bucketMs: 3_600_000 };
    const href = (outcome?: 'succeeded' | 'retried' | 'failed') =>
      new URL(
        drillDownHref('/acme/env_1/events' as Route, bucket, { endpointId: EP, outcome }),
        'http://x',
      );

    const failed = href('failed');
    expect(failed.pathname).toBe('/acme/env_1/events');
    expect(Object.fromEntries(failed.searchParams)).toEqual({
      from: '2026-11-12T14:00:00.000Z',
      to: '2026-11-12T15:00:00.000Z',
      endpointId: EP,
      status: 'failed',
    });
    // Retried deliveries have moved on to another status: no status filter.
    expect(href('retried').searchParams.has('status')).toBe(false);
    expect(href().searchParams.has('status')).toBe(false);
  });

  it('formats values for tiles, axes and tooltips', () => {
    expect(formatMs(null)).toBe('–');
    expect(formatMs(42.4)).toBe('42 ms');
    expect(formatMs(1_234)).toBe('1.2 s');
    expect(formatMs(15_000)).toBe('15 s');
    expect(formatPercent(null)).toBe('–');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.9996)).toBe('99.9%'); // a failure never rounds up to 100%
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatCount(1_284)).toBe('1,284');
    expect(formatCount(12_900)).toBe('12.9K');
  });

  it('picks round axis ticks covering the data', () => {
    expect(niceTicks(104)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(7).at(-1)).toBeGreaterThanOrEqual(7);
  });
});

describe('events drill-down filters', () => {
  it('parses filters from the URL, dropping invalid ones', () => {
    const filters = parseEventFilters({
      type: 'invoice.paid',
      from: '2026-11-12T14:00:00Z',
      to: '2026-11-12T15:00:00Z',
      endpointId: EP,
      status: 'failed',
    });
    expect(filters).toEqual({
      type: 'invoice.paid',
      from: '2026-11-12T14:00:00.000Z',
      to: '2026-11-12T15:00:00.000Z',
      endpointId: EP,
      status: 'failed',
    });
    expect(parseEventFilters({ from: 'yesterday', endpointId: 'x', status: 'exploded' })).toEqual(
      {},
    );
    // An inverted range keeps `from` only.
    expect(parseEventFilters({ from: '2026-11-12T15:00:00Z', to: '2026-11-12T14:00:00Z' })).toEqual(
      { from: '2026-11-12T15:00:00.000Z' },
    );
  });

  it('builds the API query and compares filter sets', () => {
    expect(eventsQueryString({ status: 'failed', endpointId: EP })).toBe(
      `limit=25&endpointId=${EP}&status=failed`,
    );
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ status: 'failed' })).toBe(true);
    expect(sameFilters({ type: 'a' }, { type: 'a' })).toBe(true);
    expect(sameFilters({ type: 'a' }, { type: 'a', status: 'failed' })).toBe(false);
  });

  it('labels a time range compactly', () => {
    const at = (h: number, d = 12) => new Date(2026, 10, d, h).toISOString(); // local time
    expect(formatTimeRange(at(14), at(15))).toBe('12 Nov 14:00–15:00');
    expect(formatTimeRange(at(0), at(0, 13))).toBe('12 Nov');
    expect(formatTimeRange(at(6), at(6, 13))).toBe('12 Nov 06:00 – 13 Nov 06:00');
    expect(formatTimeRange(at(6))).toBe('since 12 Nov 06:00');
  });
});
