import { type Database, deliveries, endpoints, eq, events } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { DeferError } from '@relay/queue';
import { newId } from '@relay/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DeliveryDeps, processDelivery } from '../src/delivery-handler.js';
import { acquireSlot, gcra } from '../src/rate-limit.js';
import { type Seeded, seedDelivery, startReceiver } from './fixtures.js';

describe('gcra (pure model)', () => {
  it('allows a one-second burst, then one per interval', () => {
    // 2/s: interval 500 ms, burst of 2.
    let tat: number | null = null;
    const first = gcra(2, tat, 0);
    expect(first).toEqual({ allowed: true, tatMs: 500 });
    tat = (first as { tatMs: number }).tatMs;
    const second = gcra(2, tat, 0);
    expect(second).toEqual({ allowed: true, tatMs: 1000 });
    tat = (second as { tatMs: number }).tatMs;
    expect(gcra(2, tat, 0)).toEqual({ allowed: false, waitMs: 500 });
    expect(gcra(2, tat, 500)).toMatchObject({ allowed: true }); // a slot has freed up
  });

  it('1/s has no burst', () => {
    expect(gcra(1, null, 0)).toEqual({ allowed: true, tatMs: 1000 });
    expect(gcra(1, 1000, 0)).toEqual({ allowed: false, waitMs: 1000 });
  });

  it('an idle endpoint starts fresh (old TAT in the past is ignored)', () => {
    expect(gcra(5, 1_000, 60_000)).toEqual({ allowed: true, tatMs: 60_200 });
  });
});

describe('rate limiting in Postgres', () => {
  let db: Database;
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  let deps: DeliveryDeps;

  beforeAll(async () => {
    db = (await createTestDb()).db;
    receiver = await startReceiver();
    deps = { db, timeoutMs: 2_000 };
  });
  afterAll(async () => {
    await receiver.close();
  });
  beforeEach(() => {
    receiver.received.length = 0;
    receiver.respondWith((_req, res) => res.writeHead(200).end('ok'));
  });

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

  it('acquireSlot: burst, then a wait of about one interval', async () => {
    const s = await seedDelivery(db, receiver.url, { rateLimitPerSecond: 2 });
    // One transaction freezes now(): exact GCRA arithmetic, however slow the machine.
    await db.transaction(async (tx) => {
      expect(await acquireSlot(tx, s.endpointId, 2)).toBe(0);
      expect(await acquireSlot(tx, s.endpointId, 2)).toBe(0);
      expect(await acquireSlot(tx, s.endpointId, 2)).toBe(500);
    });
  });

  it('acquireSlot: concurrent workers can never exceed the limit', async () => {
    const s = await seedDelivery(db, receiver.url, { rateLimitPerSecond: 5 });
    // Interleaved claims at one instant (frozen now()): exactly the burst gets through.
    const results = await db.transaction((tx) =>
      Promise.all(Array.from({ length: 20 }, () => acquireSlot(tx, s.endpointId, 5))),
    );
    expect(results.filter((w) => w === 0)).toHaveLength(5);
  });

  it('defers deliveries over the limit without sending or using an attempt', async () => {
    const s = await seedDelivery(db, receiver.url, { rateLimitPerSecond: 1 });
    const second = await anotherDelivery(s);

    expect(await processDelivery(deps, s.deliveryId)).toBe('succeeded');
    const held = await processDelivery(deps, second).catch((e: unknown) => e);
    expect(held).toBeInstanceOf(DeferError);
    expect((held as DeferError).message).toMatch(/rate limit \(1\/s\)/);
    expect(receiver.received).toHaveLength(1);

    const [row] = await db.select().from(deliveries).where(eq(deliveries.id, second));
    expect(row!.attemptCount).toBe(0);
    expect(row!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now()); // shown in the inspector
  });

  it('lets a manual replay through (a single request)', async () => {
    const s = await seedDelivery(db, receiver.url, { rateLimitPerSecond: 1 });
    const second = await anotherDelivery(s);
    expect(await processDelivery(deps, s.deliveryId)).toBe('succeeded');
    expect(await processDelivery(deps, second, 'manual')).toBe('succeeded');
  });

  it('costs nothing for endpoints without a limit', async () => {
    const s = await seedDelivery(db, receiver.url);
    expect(await processDelivery(deps, s.deliveryId)).toBe('succeeded');
    const [ep] = await db.select().from(endpoints).where(eq(endpoints.id, s.endpointId));
    expect(ep!.rateLimitTat).toBeNull();
  });
});
