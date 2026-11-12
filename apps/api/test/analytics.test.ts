import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type Database, deliveries, deliveryStatsHourly, eq } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { emptyHistogram, latencyBucket } from '@relay/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ORIGIN, signUpUser, type TestUser } from './helpers.js';

const HOUR = 3_600_000;
const currentHour = () => Math.floor(Date.now() / HOUR) * HOUR;

function histogram(durations: number[]): number[] {
  const h = emptyHistogram();
  for (const ms of durations) h[latencyBucket(ms)]!++;
  return h;
}

describe('analytics', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let owner: TestUser;
  let outsider: TestUser;
  let devKey: string;
  let healthy: string;
  let flaky: string;

  const get = (url: string, user = owner) =>
    app.inject({ method: 'GET', url, headers: { cookie: user.cookie } });
  const analytics = (query = '', user = owner, envId = owner.developmentEnvId) =>
    get(`/v1/environments/${envId}/analytics${query}`, user);

  beforeAll(async () => {
    const database = await createTestDb();
    db = database.db;
    app = await boot(database);
    owner = await signUpUser(app, 'charts@example.com');
    outsider = await signUpUser(app, 'nosy@example.com');
    devKey = (
      await app.inject({
        method: 'POST',
        url: `/v1/environments/${owner.developmentEnvId}/api-keys`,
        headers: { cookie: owner.cookie, origin: ORIGIN },
        payload: { name: 'charts' },
      })
    ).json().key;
    const endpoint = async (url: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/v1/endpoints',
          headers: { authorization: `Bearer ${devKey}` },
          payload: { url },
        })
      ).json().id as string;
    healthy = await endpoint('https://healthy.example.com/hooks');
    flaky = await endpoint('https://flaky.example.com/hooks');

    const row = (endpointId: string, hourMs: number, counts: object, durations: number[]) => ({
      organizationId: owner.organizationId,
      environmentId: owner.developmentEnvId,
      endpointId,
      hour: new Date(hourMs),
      ...counts,
      latencyHistogram: histogram(durations),
    });
    const fast = Array.from({ length: 98 }, () => 50);
    await db.insert(deliveryStatsHourly).values([
      // Current hour: healthy 98 fast successes; flaky 1 success, 2 retried, 1 failed.
      row(healthy, currentHour(), { succeeded: 98 }, fast),
      row(flaky, currentHour(), { succeeded: 1, retried: 2, failed: 1 }, [2_000, 3_000, 4_000]),
      // Two hours ago, and 3 days ago (outside 24h, inside 7d).
      row(healthy, currentHour() - 2 * HOUR, { succeeded: 2 }, [100, 100]),
      row(healthy, currentHour() - 72 * HOUR, { succeeded: 10 }, []),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns totals, a zero-filled hourly series and a per-endpoint table', async () => {
    const res = await analytics();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ range: '24h', bucketMs: HOUR });
    expect(body.totals).toMatchObject({ attempts: 104, succeeded: 101, retried: 2, failed: 1 });
    expect(body.totals.successRate).toBeCloseTo(101 / 104);

    expect(body.series).toHaveLength(24);
    const last = body.series.at(-1);
    expect(Date.parse(last.start)).toBe(currentHour());
    expect(last).toMatchObject({ attempts: 102, succeeded: 99 });
    expect(body.series.at(-3)).toMatchObject({ attempts: 2, succeeded: 2, successRate: 1 });
    expect(body.series[0]).toMatchObject({ attempts: 0, successRate: null, p50: null });

    // Percentiles come from merged histograms: 98 fast + 3 slow + 2 medium.
    expect(body.totals.p50).toBeGreaterThanOrEqual(40);
    expect(body.totals.p50).toBeLessThanOrEqual(60);
    expect(body.totals.p99).toBeGreaterThanOrEqual(2_000);

    expect(body.endpoints.map((e: { endpointId: string }) => e.endpointId)).toEqual([
      flaky, // most failures first
      healthy,
    ]);
    expect(body.endpoints[0]).toMatchObject({
      url: 'https://flaky.example.com/hooks',
      attempts: 4,
      successRate: 0.25,
    });
  });

  it('groups longer ranges into bigger buckets and filters by endpoint', async () => {
    const week = (await analytics('?range=7d')).json();
    expect(week.series).toHaveLength(28);
    expect(week.bucketMs).toBe(6 * HOUR);
    expect(week.totals.attempts).toBe(114);

    const one = (await analytics(`?range=7d&endpointId=${healthy}`)).json();
    expect(one.totals).toMatchObject({ attempts: 110, failed: 0 });
    expect(one.endpoints).toHaveLength(1);
  });

  it('serves API keys, and is scoped like every route', async () => {
    const viaKey = await app.inject({
      method: 'GET',
      url: '/v1/analytics',
      headers: { authorization: `Bearer ${devKey}` },
    });
    expect(viaKey.json().totals.attempts).toBe(104);

    expect((await analytics('', owner, owner.productionEnvId)).json().totals.attempts).toBe(0);
    expect((await analytics('', outsider)).statusCode).toBe(404);
    expect((await analytics('?range=1y')).statusCode).toBe(422);
  });

  it('cascades away with the endpoint', async () => {
    const temp = (
      await app.inject({
        method: 'POST',
        url: '/v1/endpoints',
        headers: { authorization: `Bearer ${devKey}` },
        payload: { url: 'https://temp.example.com/hooks' },
      })
    ).json().id as string;
    await db.insert(deliveryStatsHourly).values({
      organizationId: owner.organizationId,
      environmentId: owner.developmentEnvId,
      endpointId: temp,
      hour: new Date(currentHour()),
      succeeded: 5,
      latencyHistogram: emptyHistogram(),
    });
    await app.inject({
      method: 'DELETE',
      url: `/v1/endpoints/${temp}`,
      headers: { authorization: `Bearer ${devKey}` },
    });
    expect(
      await db.select().from(deliveryStatsHourly).where(eq(deliveryStatsHourly.endpointId, temp)),
    ).toHaveLength(0);
  });
});

describe('event list drill-down filters', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let owner: TestUser;
  let key: string;
  let a: string;
  let b: string;

  const list = async (query: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/events?${query}`,
      headers: { authorization: `Bearer ${key}` },
    });
    return res;
  };
  const ids = async (query: string) =>
    (await list(query)).json().data.map((e: { type: string }) => e.type);

  beforeAll(async () => {
    const database = await createTestDb();
    db = database.db;
    app = await boot(database);
    owner = await signUpUser(app, 'drill@example.com');
    key = (
      await app.inject({
        method: 'POST',
        url: `/v1/environments/${owner.developmentEnvId}/api-keys`,
        headers: { cookie: owner.cookie, origin: ORIGIN },
        payload: { name: 'drill' },
      })
    ).json().key;
    const endpoint = async (url: string, filterEventTypes?: string[]) =>
      (
        await app.inject({
          method: 'POST',
          url: '/v1/endpoints',
          headers: { authorization: `Bearer ${key}` },
          payload: { url, filterEventTypes },
        })
      ).json().id as string;
    a = await endpoint('https://a.example.com/hooks');
    b = await endpoint('https://b.example.com/hooks', ['only.b']);
    for (const type of ['first', 'only.b', 'last']) {
      await app.inject({
        method: 'POST',
        url: '/v1/events',
        headers: { authorization: `Bearer ${key}` },
        payload: { type, data: {} },
      });
      await new Promise((r) => setTimeout(r, 5)); // distinct milliseconds
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('filters by creation time using the time-sortable id', async () => {
    const all = (await list('limit=10')).json().data as { type: string; createdAt: string }[];
    expect(all.map((e) => e.type)).toEqual(['last', 'only.b', 'first']);
    const middle = Date.parse(all[1]!.createdAt);
    expect(await ids(`from=${new Date(middle).toISOString()}`)).toEqual(['last', 'only.b']);
    expect(await ids(`to=${new Date(middle).toISOString()}`)).toEqual(['first']);
    expect((await list('from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z')).statusCode).toBe(422);
  });

  it('filters by endpoint and delivery status', async () => {
    expect(await ids(`endpointId=${b}`)).toEqual(['only.b']);
    expect(await ids(`endpointId=${a}`)).toEqual(['last', 'only.b', 'first']);

    const [delivery] = await db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(eq(deliveries.endpointId, b));
    await db.update(deliveries).set({ status: 'failed' }).where(eq(deliveries.id, delivery!.id));
    expect(await ids('status=failed')).toEqual(['only.b']);
    expect(await ids(`status=failed&endpointId=${a}`)).toEqual([]);
    expect(await ids('status=pending')).toEqual(['last', 'only.b', 'first']);
  });
});
