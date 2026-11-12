import { describe, expect, it } from 'vitest';
import {
  describeFilter,
  invalidEventType,
  parseEventTypes,
  verifySnippet,
} from '@/features/endpoints/helpers';
import {
  attemptLabel,
  deliverySummary,
  explainAttempt,
  formatDelta,
  formatDuration,
  prettyJson,
} from '@/features/events/explain';
import { eventsQueryString, normaliseTypeFilter } from '@/features/events/query';
import { failuresInARow, healthSummary } from '@/features/endpoints/health';

const attempt = (statusCode: number | null, errorCode: string | null = null) => ({
  statusCode,
  errorCode,
});

describe('explainAttempt', () => {
  it('has nothing to explain for a 2xx', () => {
    expect(explainAttempt(attempt(200))).toBeNull();
    expect(explainAttempt(attempt(204))).toBeNull();
  });

  it('matches the worker retry policy: 4xx is final except 408/429; 3xx and 5xx retry', () => {
    expect(explainAttempt(attempt(400))!.retried).toBe(false);
    expect(explainAttempt(attempt(401))!.retried).toBe(false);
    expect(explainAttempt(attempt(404))!.retried).toBe(false);
    expect(explainAttempt(attempt(408))!.retried).toBe(true);
    expect(explainAttempt(attempt(429))!.retried).toBe(true);
    expect(explainAttempt(attempt(301))!.retried).toBe(true);
    expect(explainAttempt(attempt(503))!.retried).toBe(true);
    expect(explainAttempt(attempt(null, 'blocked_port'))!.retried).toBe(false);
    expect(explainAttempt(attempt(null, 'blocked_address'))!.retried).toBe(false);
    expect(explainAttempt(attempt(null, 'timeout'))!.retried).toBe(true);
  });

  it('gives actionable advice, not just a code', () => {
    expect(explainAttempt(attempt(302))!.detail).toMatch(/never follows redirects/);
    expect(explainAttempt(attempt(401))!.detail).toMatch(/signing secret/);
    expect(explainAttempt(attempt(null, 'timeout'))!.title).toMatch(/didn't respond in time/);
    expect(explainAttempt(attempt(null, 'tls'))!.detail).toMatch(/certificate/);
    expect(explainAttempt(attempt(null, 'something_new'))!.title).toMatch(/network error/);
  });
});

describe('attempt formatting', () => {
  it('labels outcomes', () => {
    expect(attemptLabel(attempt(503))).toBe('503');
    expect(attemptLabel(attempt(null, 'connection_refused'))).toBe('Refused');
    expect(attemptLabel(attempt(null, null))).toBe('Error');
    expect(attemptLabel(attempt(null, 'blocked_address'))).toBe('Blocked address');
  });

  it('formats gaps between attempts so backoff is visible', () => {
    expect(formatDelta(6_000)).toBe('+6s');
    expect(formatDelta(124_000)).toBe('+2m 4s');
    expect(formatDelta(120_000)).toBe('+2m');
    expect(formatDelta(3_900_000)).toBe('+1h 5m');
    expect(formatDelta(-5)).toBe('+0s');
  });

  it('formats durations', () => {
    expect(formatDuration(212)).toBe('212 ms');
    expect(formatDuration(1234)).toBe('1.2 s');
  });

  it('summarises a delivery in words', () => {
    expect(deliverySummary('succeeded', 1)).toBe('Delivered on the first attempt');
    expect(deliverySummary('succeeded', 3)).toBe('Delivered after 3 attempts');
    expect(deliverySummary('failed', 8)).toBe('Failed after 8 attempts; no more retries');
    expect(deliverySummary('pending', 0)).toBe('Queued; not attempted yet');
    expect(deliverySummary('pending', 2)).toBe('2 attempts so far; next attempt queued');
  });

  it('pretty-prints JSON and leaves other text alone', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson('<html>oops</html>')).toBe('<html>oops</html>');
    expect(prettyJson(null)).toBe('');
  });
});

describe('endpoint helpers', () => {
  it('parses event type lists; blank means every type', () => {
    expect(parseEventTypes('invoice.paid, user.created\ninvoice.paid')).toEqual([
      'invoice.paid',
      'user.created',
    ]);
    expect(parseEventTypes('  ,  ')).toBeNull();
  });

  it('finds the first invalid event type', () => {
    expect(invalidEventType('invoice.paid, bad type!')).toBe('type!');
    expect(invalidEventType('invoice..paid')).toBe('invoice..paid');
    expect(invalidEventType('invoice.paid')).toBeUndefined();
  });

  it('describes a subscription briefly', () => {
    expect(describeFilter(null)).toBe('All event types');
    expect(describeFilter(['a', 'b'])).toBe('a, b');
    expect(describeFilter(['a', 'b', 'c', 'd'])).toBe('a, b +2 more');
  });

  it('builds a verification snippet with the secret filled in', () => {
    expect(verifySnippet('whsec_abc')).toContain("new Webhook('whsec_abc')");
  });
});

describe('events query', () => {
  it('builds the list query string', () => {
    expect(eventsQueryString({})).toBe('limit=25');
    expect(eventsQueryString({ type: 'invoice.paid' }, 'evt_X')).toBe(
      'limit=25&type=invoice.paid&cursor=evt_X',
    );
  });

  it('ignores invalid ?type= values instead of erroring', () => {
    expect(normaliseTypeFilter('invoice.paid')).toBe('invoice.paid');
    expect(normaliseTypeFilter(['a.b', 'c'])).toBe('a.b');
    expect(normaliseTypeFilter('drop table;')).toBeUndefined();
    expect(normaliseTypeFilter(undefined)).toBeUndefined();
  });
});

describe('endpoint health summary', () => {
  const health = {
    consecutiveFailures: 0,
    failingSince: null,
    circuitOpenUntil: null,
    lastSuccessAt: null,
  };

  it('puts the most urgent state first', () => {
    expect(
      healthSummary({
        status: 'active',
        health: {
          ...health,
          consecutiveFailures: 7,
          failingSince: '2026-11-12T00:00:00Z',
          circuitOpenUntil: '2026-11-12T01:00:00Z',
        },
      }),
    ).toEqual({ kind: 'circuit_open', failures: 7, until: '2026-11-12T01:00:00Z' });
    expect(
      healthSummary({
        status: 'active',
        health: { ...health, consecutiveFailures: 2, failingSince: '2026-11-12T00:00:00Z' },
      }),
    ).toMatchObject({ kind: 'failing', failures: 2 });
    expect(
      healthSummary({
        status: 'active',
        health: { ...health, lastSuccessAt: '2026-11-12T00:00:00Z' },
      }),
    ).toMatchObject({ kind: 'healthy' });
    expect(healthSummary({ status: 'active', health })).toEqual({ kind: 'no_deliveries' });
  });

  it('says nothing for paused or disabled endpoints (their status/reason says it)', () => {
    expect(healthSummary({ status: 'disabled', health })).toBeNull();
    expect(healthSummary({ status: 'paused', health })).toBeNull();
  });

  it('pluralises failure counts', () => {
    expect(failuresInARow(1)).toBe('1 failure');
    expect(failuresInARow(5)).toBe('5 failures in a row');
  });
});
