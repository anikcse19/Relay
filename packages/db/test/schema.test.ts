import { newId } from '@relay/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliveries, endpoints, environments, events, organizations } from '../src/schema.js';
import { createTestDb } from '../src/testing.js';

let ctx: Awaited<ReturnType<typeof createTestDb>>;
const orgId = newId('organization');
const envId = newId('environment');
const endpointId = newId('endpoint');

beforeAll(async () => {
  ctx = await createTestDb();
  await ctx.db.insert(organizations).values({ id: orgId, name: 'Acme', slug: 'acme' });
  await ctx.db
    .insert(environments)
    .values({ id: envId, organizationId: orgId, name: 'Production', kind: 'production' });
  await ctx.db.insert(endpoints).values({
    id: endpointId,
    organizationId: orgId,
    environmentId: envId,
    url: 'https://example.com/webhooks',
    signingSecret: 'whsec_test',
  });
});

afterAll(async () => {
  await ctx.close();
});

describe('schema constraints', () => {
  it('rejects a duplicate idempotency key within an environment', async () => {
    const base = {
      organizationId: orgId,
      environmentId: envId,
      eventType: 'invoice.paid',
      payload: {},
    };
    await ctx.db.insert(events).values({ ...base, id: newId('event'), idempotencyKey: 'k1' });
    await expect(
      ctx.db.insert(events).values({ ...base, id: newId('event'), idempotencyKey: 'k1' }),
    ).rejects.toThrow();
  });

  it('allows many events without an idempotency key', async () => {
    const base = {
      organizationId: orgId,
      environmentId: envId,
      eventType: 'invoice.paid',
      payload: {},
    };
    await ctx.db.insert(events).values([
      { ...base, id: newId('event') },
      { ...base, id: newId('event') },
    ]);
  });

  it('makes fan-out idempotent: one delivery per (event, endpoint)', async () => {
    const eventId = newId('event');
    await ctx.db.insert(events).values({
      id: eventId,
      organizationId: orgId,
      environmentId: envId,
      eventType: 'invoice.paid',
      payload: { amount: 100 },
    });
    const delivery = { organizationId: orgId, environmentId: envId, eventId, endpointId };
    await ctx.db.insert(deliveries).values({ ...delivery, id: newId('delivery') });

    const second = await ctx.db
      .insert(deliveries)
      .values({ ...delivery, id: newId('delivery') })
      .onConflictDoNothing()
      .returning();
    expect(second).toHaveLength(0);
  });
});
