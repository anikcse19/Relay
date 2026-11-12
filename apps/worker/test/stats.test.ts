import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  asc,
  type Database,
  deliveries,
  deliveryStatsHourly,
  eq,
  events,
  migrationsFolder,
  sql,
} from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import {
  histogramPercentile,
  LATENCY_BOUNDS_MS,
  LATENCY_BUCKETS,
  latencyBucket,
  newId,
} from '@relay/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DeliveryDeps, processDelivery } from '../src/delivery-handler.js';
import type { SendResult } from '../src/http-client.js';
import { pruneOnce } from '../src/maintenance.js';
import { type Seeded, seedDelivery } from './fixtures.js';

const response = (statusCode: number | null, durationMs: number): SendResult => ({
  statusCode,
  durationMs,
  responseHeaders: statusCode === null ? null : {},
  responseBody: null,
  errorCode: statusCode === null ? 'connection_refused' : statusCode >= 300 ? 'http_error' : null,
  errorMessage: statusCode === null ? 'refused' : null,
});

/** The backfill statement appended to the migration that created the rollup. */
function backfillSql(): string {
  const file = readdirSync(migrationsFolder).find((f) => f.includes('delivery_stats'))!;
  const statements = readFileSync(join(migrationsFolder, file), 'utf8').split(
    '--> statement-breakpoint',
  );
  return statements.find((s) => s.includes('INSERT INTO "delivery_stats_hourly"'))!;
}

describe('hourly delivery stats', () => {
  let db: Database;
  let s: Seeded;
  let next: SendResult;
  let deps: DeliveryDeps;

  beforeEach(async () => {
    db = (await createTestDb()).db;
    s = await seedDelivery(db, 'https://example.com/hooks');
    deps = {
      db,
      timeoutMs: 1_000,
      send: async () => next,
      health: {
        circuitThreshold: 100,
        circuitBaseMs: 1_000,
        circuitCapMs: 1_000,
        autoDisableAfterMs: 1e12,
      },
    };
  });

  async function attempt(result: SendResult, trigger: 'scheduled' | 'manual' = 'scheduled') {
    const eventId = newId('event');
    await db.insert(events).values({
      id: eventId,
      organizationId: s.organizationId,
      environmentId: s.environmentId,
      eventType: 'invoice.paid',
      payload: {},
    });
    const deliveryId = newId('delivery');
    await db.insert(deliveries).values({
      id: deliveryId,
      organizationId: s.organizationId,
      environmentId: s.environmentId,
      eventId,
      endpointId: s.endpointId,
      nextAttemptAt: new Date(),
    });
    next = result;
    await processDelivery(deps, deliveryId, trigger).catch(() => undefined); // retries throw
  }

  const rows = () =>
    db
      .select()
      .from(deliveryStatsHourly)
      .where(eq(deliveryStatsHourly.endpointId, s.endpointId))
      .orderBy(asc(deliveryStatsHourly.hour));

  async function runAll() {
    await attempt(response(200, 42)); // succeeded
    await attempt(response(200, 180)); // succeeded
    await attempt(response(503, 900)); // retried
    await attempt(response(null, 5)); // retried, no latency (no response)
    await attempt(response(404, 30)); // failed: non-retryable
    await attempt(response(500, 2_500), 'manual'); // failed: replays don't retry
  }

  it('counts every attempt once, in its UTC hour, in the same transaction', async () => {
    await runAll();
    const [row, ...rest] = await rows();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      organizationId: s.organizationId,
      environmentId: s.environmentId,
      succeeded: 2,
      retried: 2,
      failed: 2,
    });
    expect(row!.hour.getTime() % 3_600_000).toBe(0);
    expect(Date.now() - row!.hour.getTime()).toBeLessThan(3_600_000);

    const h = row!.latencyHistogram;
    expect(h).toHaveLength(LATENCY_BUCKETS);
    expect(h.reduce((a, b) => a + b)).toBe(5); // responses only
    for (const ms of [42, 180, 900, 30, 2_500]) expect(h[latencyBucket(ms)]).toBeGreaterThan(0);
    expect(histogramPercentile(h, 0.5)).toBeGreaterThanOrEqual(150);
  });

  it('the migration backfill reproduces the live rollup from delivery_attempts', async () => {
    await runAll();
    const live = await rows();
    await db.delete(deliveryStatsHourly);
    await db.execute(sql.raw(backfillSql()));
    expect(await rows()).toEqual(live);
  });

  it('the backfill uses the same latency buckets as @relay/shared', () => {
    const statement = backfillSql();
    const bounds = /ARRAY\[([\d,]+)\]::int\[\]/.exec(statement)![1]!.split(',').map(Number);
    expect(bounds).toEqual([...LATENCY_BOUNDS_MS]);
    expect(statement).toContain(`generate_series(1, ${LATENCY_BUCKETS})`);
  });

  it('retention keeps rollups for at least 90 days', async () => {
    await attempt(response(200, 10));
    const hour = (daysAgo: number) =>
      new Date(Math.floor((Date.now() - daysAgo * 86_400_000) / 3_600_000) * 3_600_000);
    const old = (daysAgo: number) => ({
      organizationId: s.organizationId,
      environmentId: s.environmentId,
      endpointId: s.endpointId,
      hour: hour(daysAgo),
      succeeded: 1,
      latencyHistogram: new Array<number>(LATENCY_BUCKETS).fill(0),
    });
    await db.insert(deliveryStatsHourly).values([old(40), old(91)]);

    expect(await pruneOnce(db, { retentionDays: 30 })).toMatchObject({ stats: 1 });
    expect(await rows()).toHaveLength(2); // the 40-day-old row and the current hour
  });
});
