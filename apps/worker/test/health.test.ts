import { type Database, deliveries, deliveryAttempts, endpoints, eq, events, sql } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { DeferError } from '@relay/queue';
import { newId } from '@relay/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DeliveryDeps, processDelivery } from '../src/delivery-handler.js';
import {
  autoDisableReason,
  circuitCooldownMs,
  claimProbe,
  DEFAULT_HEALTH,
  type HealthPolicy,
} from '../src/health.js';
import { type Seeded, seedDelivery, startReceiver } from './fixtures.js';

const HEALTH: HealthPolicy = {
  circuitThreshold: 2,
  circuitBaseMs: 60_000,
  circuitCapMs: 10 * 60_000,
  autoDisableAfterMs: 5 * 24 * 3_600_000,
};

describe('circuitCooldownMs', () => {
  it('stays closed below the threshold, then doubles up to the cap', () => {
    expect(circuitCooldownMs(1, HEALTH)).toBeNull();
    expect(circuitCooldownMs(2, HEALTH)).toBe(60_000);
    expect(circuitCooldownMs(3, HEALTH)).toBe(120_000);
    expect(circuitCooldownMs(4, HEALTH)).toBe(240_000);
    expect(circuitCooldownMs(20, HEALTH)).toBe(600_000);
    expect(circuitCooldownMs(100_000, HEALTH)).toBe(600_000); // no overflow
  });

  it('explains auto-disable in words', () => {
    expect(autoDisableReason(DEFAULT_HEALTH)).toMatch(/failed for 5 days/);
    expect(autoDisableReason({ ...DEFAULT_HEALTH, autoDisableAfterMs: 36 * 3_600_000 })).toMatch(
      /36 hours/,
    );
  });
});

describe('endpoint health in the delivery handler', () => {
  let db: Database;
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  let deps: DeliveryDeps;

  beforeAll(async () => {
    db = (await createTestDb()).db;
    receiver = await startReceiver();
    deps = {
      db,
      timeoutMs: 2_000,
      health: HEALTH,
      backoff: { baseMs: 60_000, capMs: 3_600_000, maxAttempts: 10 },
    };
  });
  afterAll(async () => {
    await receiver.close();
  });
  beforeEach(() => {
    receiver.received.length = 0;
    receiver.respondWith((_req, res) => res.writeHead(200).end('ok'));
  });

  const endpointRow = async (id: string) =>
    (await db.select().from(endpoints).where(eq(endpoints.id, id)))[0]!;
  const deliveryRow = async (id: string) =>
    (await db.select().from(deliveries).where(eq(deliveries.id, id)))[0]!;
  const secondsUntil = (date: Date | null) => (date!.getTime() - Date.now()) / 1000;
  const fail = () => receiver.respondWith((_req, res) => res.writeHead(500).end());

  /** Another due delivery to the same endpoint. */
  async function anotherDelivery(s: Seeded): Promise<string> {
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
    return deliveryId;
  }

  /** Runs one attempt, swallowing the retry signal. */
  const attempt = (id: string, trigger: 'scheduled' | 'manual' = 'scheduled') =>
    processDelivery(deps, id, trigger).catch((e: unknown) => e);

  it('counts a failure streak and opens the circuit at the threshold', async () => {
    const s = await seedDelivery(db, receiver.url);
    fail();

    await attempt(s.deliveryId);
    let ep = await endpointRow(s.endpointId);
    expect(ep).toMatchObject({ consecutiveFailures: 1, circuitOpenUntil: null });
    expect(ep.failingSince).not.toBeNull();
    const streakStarted = ep.failingSince!.getTime();

    await attempt(await anotherDelivery(s));
    ep = await endpointRow(s.endpointId);
    expect(ep.consecutiveFailures).toBe(2);
    expect(ep.failingSince!.getTime()).toBe(streakStarted); // first failure of the streak
    expect(secondsUntil(ep.circuitOpenUntil)).toBeGreaterThan(55);
    expect(secondsUntil(ep.circuitOpenUntil)).toBeLessThanOrEqual(60);
  });

  it('holds scheduled deliveries while the circuit is open, without sending or using attempts', async () => {
    const s = await seedDelivery(db, receiver.url, {
      consecutiveFailures: 2,
      failingSince: new Date(),
      circuitOpenUntil: new Date(Date.now() + 60_000),
    });

    const result = await attempt(s.deliveryId);
    expect(result).toBeInstanceOf(DeferError);
    expect((result as DeferError).delayMs).toBeGreaterThan(55_000);
    expect(receiver.received).toHaveLength(0);

    const d = await deliveryRow(s.deliveryId);
    expect(d.attemptCount).toBe(0);
    expect(secondsUntil(d.nextAttemptAt)).toBeGreaterThan(55); // visible in the inspector
  });

  it('lets a manual replay through an open circuit', async () => {
    const s = await seedDelivery(db, receiver.url, {
      consecutiveFailures: 3,
      failingSince: new Date(),
      circuitOpenUntil: new Date(Date.now() + 60_000),
    });
    expect(await attempt(s.deliveryId, 'manual')).toBe('succeeded');
    expect(await endpointRow(s.endpointId)).toMatchObject({
      consecutiveFailures: 0,
      failingSince: null,
      circuitOpenUntil: null,
    });
  });

  it('half-open: one probe after the cooldown; success closes the circuit', async () => {
    const s = await seedDelivery(db, receiver.url, {
      consecutiveFailures: 4,
      failingSince: new Date(),
      circuitOpenUntil: new Date(Date.now() - 1_000),
    });
    expect(await attempt(s.deliveryId)).toBe('succeeded');
    const ep = await endpointRow(s.endpointId);
    expect(ep).toMatchObject({ consecutiveFailures: 0, circuitOpenUntil: null });
    expect(ep.lastSuccessAt).not.toBeNull();
  });

  it('half-open: only one worker can claim the probe', async () => {
    const s = await seedDelivery(db, receiver.url, {
      circuitOpenUntil: new Date(Date.now() - 1_000),
    });
    const claims = await Promise.all([
      claimProbe(db, s.endpointId, 10_000),
      claimProbe(db, s.endpointId, 10_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('half-open: a failed probe re-opens the circuit for longer', async () => {
    const s = await seedDelivery(db, receiver.url, {
      consecutiveFailures: 2,
      failingSince: new Date(),
      circuitOpenUntil: new Date(Date.now() - 1_000),
    });
    fail();
    await attempt(s.deliveryId);
    const ep = await endpointRow(s.endpointId);
    expect(ep.consecutiveFailures).toBe(3);
    expect(secondsUntil(ep.circuitOpenUntil)).toBeGreaterThan(115); // 2 × 60 s
  });

  it('auto-disables an endpoint failing for longer than the policy, cancelling its queue', async () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 3_600_000);
    const s = await seedDelivery(db, receiver.url, {
      consecutiveFailures: 40,
      failingSince: sixDaysAgo,
    });
    const queued = await anotherDelivery(s);
    fail();

    expect(await attempt(s.deliveryId)).toBe('cancelled');
    const ep = await endpointRow(s.endpointId);
    expect(ep.status).toBe('disabled');
    expect(ep.disabledReason).toMatch(/failed for 5 days/);
    expect((await deliveryRow(s.deliveryId)).status).toBe('cancelled');
    expect((await deliveryRow(queued)).status).toBe('cancelled');
    // The failing attempt itself is still in the log.
    const attempts = await db
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, s.deliveryId));
    expect(attempts).toHaveLength(1);
  });

  it('does not disable a recent streak, however many failures', async () => {
    const s = await seedDelivery(db, receiver.url, {
      consecutiveFailures: 400,
      failingSince: new Date(Date.now() - 3_600_000),
    });
    fail();
    await attempt(s.deliveryId);
    expect((await endpointRow(s.endpointId)).status).toBe('active');
  });

  it("doesn't rewrite a healthy endpoint's row on every success", async () => {
    const s = await seedDelivery(db, receiver.url);
    await attempt(s.deliveryId);
    const first = (await endpointRow(s.endpointId)).lastSuccessAt!;
    await attempt(await anotherDelivery(s));
    expect((await endpointRow(s.endpointId)).lastSuccessAt!.getTime()).toBe(first.getTime());
    // ...but does after a minute.
    await db
      .update(endpoints)
      .set({ lastSuccessAt: sql`now() - interval '2 minutes'` })
      .where(eq(endpoints.id, s.endpointId));
    await attempt(await anotherDelivery(s));
    expect(secondsUntil((await endpointRow(s.endpointId)).lastSuccessAt)).toBeGreaterThan(-5);
  });
});
