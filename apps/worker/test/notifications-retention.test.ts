import {
  type Database,
  deliveries,
  deliveryAttempts,
  endpoints,
  eq,
  events,
  inArray,
  notifications,
  queueJobs,
  sql,
} from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { newId } from '@relay/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DeliveryDeps, processDelivery } from '../src/delivery-handler.js';
import type { HealthPolicy } from '../src/health.js';
import { pruneOnce } from '../src/maintenance.js';
import { type Seeded, seedDelivery, startReceiver } from './fixtures.js';

const HEALTH: HealthPolicy = {
  circuitThreshold: 2,
  circuitBaseMs: 60_000,
  circuitCapMs: 600_000,
  autoDisableAfterMs: 5 * 24 * 3_600_000,
};
const DAY = 24 * 3_600_000;

async function addDelivery(db: Database, s: Seeded, eventId = newId('event')) {
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
  return { eventId, deliveryId };
}

describe('notifications on endpoint health transitions', () => {
  let db: Database;
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  let deps: DeliveryDeps;

  beforeAll(async () => {
    db = (await createTestDb()).db;
    receiver = await startReceiver();
    deps = { db, timeoutMs: 2_000, health: HEALTH };
  });
  afterAll(async () => {
    await receiver.close();
  });
  beforeEach(() => receiver.respondWith((_req, res) => res.writeHead(200).end()));

  const alertsFor = (endpointId: string) =>
    db.select().from(notifications).where(eq(notifications.endpointId, endpointId));
  const fail = () => receiver.respondWith((_req, res) => res.writeHead(500).end());
  // Manual attempts bypass the open circuit, which keeps these tests short.
  const attempt = (id: string) => processDelivery(deps, id, 'manual').catch(() => undefined);

  it('alerts once when the circuit opens, then once when it recovers', async () => {
    const s = await seedDelivery(db, receiver.url);
    fail();
    await attempt(s.deliveryId);
    expect(await alertsFor(s.endpointId)).toHaveLength(0); // 1 failure: below threshold
    await attempt((await addDelivery(db, s)).deliveryId);
    await attempt((await addDelivery(db, s)).deliveryId); // 3rd failure: no duplicate alert

    let alerts = await alertsFor(s.endpointId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'endpoint_failing',
      organizationId: s.organizationId,
      environmentId: s.environmentId,
      endpointUrl: receiver.url,
      readAt: null,
    });
    expect(alerts[0]!.title).toBe(`Endpoint failing: ${new URL(receiver.url).host}`);
    expect(alerts[0]!.body).toMatch(/^2 deliveries in a row failed/);

    receiver.respondWith((_req, res) => res.writeHead(200).end());
    await attempt((await addDelivery(db, s)).deliveryId);
    alerts = await alertsFor(s.endpointId);
    expect(alerts.map((a) => a.kind)).toEqual(['endpoint_failing', 'endpoint_recovered']);
    expect(alerts[1]!.body).toMatch(/after 3 failures in a row/);

    // Healthy successes afterwards don't alert again.
    await attempt((await addDelivery(db, s)).deliveryId);
    expect(await alertsFor(s.endpointId)).toHaveLength(2);
  });

  it('a success after a short streak (circuit never opened) is not a "recovery"', async () => {
    const s = await seedDelivery(db, receiver.url);
    fail();
    await attempt(s.deliveryId);
    receiver.respondWith((_req, res) => res.writeHead(200).end());
    await attempt((await addDelivery(db, s)).deliveryId);
    expect(await alertsFor(s.endpointId)).toHaveLength(0);
  });

  it('alerts when an endpoint is auto-disabled, with the reason', async () => {
    const s = await seedDelivery(db, receiver.url, {
      consecutiveFailures: 30,
      failingSince: new Date(Date.now() - 6 * DAY),
    });
    fail();
    await attempt(s.deliveryId);
    const alerts = await alertsFor(s.endpointId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'endpoint_disabled' });
    expect(alerts[0]!.body).toMatch(/failed for 5 days/);
  });

  it('keeps the alert when the endpoint is deleted (history), unlinking it', async () => {
    const s = await seedDelivery(db, receiver.url);
    fail();
    await attempt(s.deliveryId);
    await attempt((await addDelivery(db, s)).deliveryId);
    await db.delete(endpoints).where(eq(endpoints.id, s.endpointId));
    const orphaned = await db
      .select()
      .from(notifications)
      .where(eq(notifications.endpointUrl, receiver.url));
    expect(orphaned.some((n) => n.endpointId === null)).toBe(true);
  });
});

describe('retention', () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()).db;
  });

  async function seedAt(ageDays: number, status: 'succeeded' | 'pending' = 'succeeded') {
    const s = await seedDelivery(db, 'https://example.com/hooks');
    const eventId = newId('event', Date.now() - ageDays * DAY);
    const { deliveryId } = await addDelivery(db, s, eventId);
    await db.update(deliveries).set({ status }).where(eq(deliveries.id, deliveryId));
    await db.insert(deliveryAttempts).values({
      id: newId('attempt'),
      organizationId: s.organizationId,
      deliveryId,
      attemptNumber: 1,
      statusCode: 200,
      durationMs: 10,
    });
    return { ...s, oldEventId: eventId, oldDeliveryId: deliveryId };
  }

  it('deletes old finished history with its deliveries and attempts', async () => {
    const old = await seedAt(40);
    const recent = await seedAt(5);

    expect(await pruneOnce(db, { retentionDays: 30 })).toMatchObject({ events: 1 });

    const left = await db
      .select({ id: events.id })
      .from(events)
      .where(inArray(events.id, [old.oldEventId, recent.oldEventId]));
    expect(left.map((e) => e.id)).toEqual([recent.oldEventId]);
    expect(
      await db.select().from(deliveries).where(eq(deliveries.id, old.oldDeliveryId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(deliveryAttempts)
        .where(eq(deliveryAttempts.deliveryId, old.oldDeliveryId)),
    ).toHaveLength(0);
  });

  it('never deletes an event while one of its deliveries is in flight', async () => {
    const inFlight = await seedAt(40, 'pending');
    await pruneOnce(db, { retentionDays: 30 });
    expect(await db.select().from(events).where(eq(events.id, inFlight.oldEventId))).toHaveLength(
      1,
    );
  });

  it('works through a backlog in batches', async () => {
    for (let i = 0; i < 5; i++) await seedAt(40 + i);
    expect(await pruneOnce(db, { retentionDays: 30, batchSize: 2 })).toMatchObject({ events: 5 });
  });

  it('prunes read notifications after the retention window, unread ones after 90 days', async () => {
    const s = await seedDelivery(db, 'https://example.com/hooks');
    const alert = (ageDays: number, read: boolean) => ({
      id: newId('notification'),
      organizationId: s.organizationId,
      environmentId: s.environmentId,
      endpointId: s.endpointId,
      endpointUrl: 'https://example.com/hooks',
      kind: 'endpoint_failing' as const,
      title: 't',
      body: 'b',
      readAt: read ? new Date() : null,
      createdAt: new Date(Date.now() - ageDays * DAY),
    });
    const oldRead = alert(40, true);
    const oldUnread = alert(40, false);
    const ancientUnread = alert(100, false);
    const recentRead = alert(2, true);
    await db.insert(notifications).values([oldRead, oldUnread, ancientUnread, recentRead]);

    expect(await pruneOnce(db, { retentionDays: 30 })).toMatchObject({ notifications: 2 });
    const kept = await db.select({ id: notifications.id }).from(notifications);
    expect(kept.map((n) => n.id).sort()).toEqual([oldUnread.id, recentRead.id].sort());
  });

  it('prunes old dead-lettered queue jobs only', async () => {
    await db.insert(queueJobs).values([
      { queue: 'delivery', payload: {}, status: 'dead', dedupeKey: 'old-dead' },
      { queue: 'delivery', payload: {}, status: 'dead', dedupeKey: 'new-dead' },
      { queue: 'delivery', payload: {}, status: 'pending', dedupeKey: 'old-pending' },
    ]);
    await db
      .update(queueJobs)
      .set({ updatedAt: sql`now() - interval '40 days'` })
      .where(inArray(queueJobs.dedupeKey, ['old-dead', 'old-pending']));

    expect(await pruneOnce(db, { retentionDays: 30 })).toMatchObject({ deadJobs: 1 });
    const left = await db.select({ key: queueJobs.dedupeKey }).from(queueJobs);
    expect(left.map((j) => j.key).sort()).toEqual(['new-dead', 'old-pending']);
  });
});
