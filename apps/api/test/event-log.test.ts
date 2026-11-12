import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type Database, deliveries, deliveryAttempts, endpoints, eq, queueJobs } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { newId, webhookBody } from '@relay/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ORIGIN, signUpUser, type TestUser } from './helpers.js';

describe('event log: listing events and inspecting deliveries', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let owner: TestUser;
  let outsider: TestUser;
  let devKey: string;
  let prodKey: string;
  let endpointA: string;
  let endpointB: string;
  const sent: { id: string; type: string }[] = [];

  const asKey = (url: string, key = devKey) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${key}` } });
  const asUser = (user: TestUser, url: string) =>
    app.inject({ method: 'GET', url, headers: { cookie: user.cookie } });
  const env = (user: TestUser) => `/v1/environments/${user.developmentEnvId}`;

  async function post(url: string, payload: object, key = devKey) {
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${key}` },
      payload,
    });
    expect(res.statusCode).toBeLessThan(300);
    return res.json();
  }

  beforeAll(async () => {
    const database = await createTestDb();
    db = database.db;
    app = await boot(database);
    owner = await signUpUser(app, 'logs@example.com');
    outsider = await signUpUser(app, 'nosy@example.com');

    const createKey = async (envId: string) =>
      (
        await app.inject({
          method: 'POST',
          url: `/v1/environments/${envId}/api-keys`,
          headers: { cookie: owner.cookie, origin: ORIGIN },
          payload: { name: 'logs' },
        })
      ).json().key as string;
    devKey = await createKey(owner.developmentEnvId);
    prodKey = await createKey(owner.productionEnvId);

    endpointA = (await post('/v1/endpoints', { url: 'https://a.example.com/hooks' })).id;
    endpointB = (
      await post('/v1/endpoints', {
        url: 'https://b.example.com/hooks',
        filterEventTypes: ['invoice.paid'],
      })
    ).id;

    for (const type of ['invoice.paid', 'user.created', 'invoice.paid']) {
      const event = await post('/v1/events', { type, data: { n: sent.length } });
      sent.push({ id: event.id, type });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/events', () => {
    it('lists newest first with delivery counts per status', async () => {
      const res = await asKey('/v1/events');
      expect(res.statusCode).toBe(200);
      const page = res.json();
      expect(page.nextCursor).toBeNull();
      expect(page.data.map((e: { id: string }) => e.id)).toEqual(
        sent
          .map((e) => e.id)
          .sort()
          .reverse(),
      );
      const paid = page.data.find((e: { id: string }) => e.id === sent[0]!.id);
      expect(paid).toMatchObject({
        type: 'invoice.paid',
        deliveryCounts: { pending: 2, retrying: 0, succeeded: 0, failed: 0, cancelled: 0 },
      });
      expect(paid).not.toHaveProperty('data'); // payloads only on the detail view
      const created = page.data.find((e: { id: string }) => e.id === sent[1]!.id);
      expect(created.deliveryCounts.pending).toBe(1); // endpoint B filters it out
    });

    it('filters by type and paginates', async () => {
      const first = (await asKey('/v1/events?type=invoice.paid&limit=1')).json();
      expect(first.data).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const second = (
        await asKey(`/v1/events?type=invoice.paid&limit=1&cursor=${first.nextCursor}`)
      ).json();
      expect(second.data).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect([first.data[0].id, second.data[0].id].sort()).toEqual(
        sent
          .filter((e) => e.type === 'invoice.paid')
          .map((e) => e.id)
          .sort(),
      );
    });

    it('is served to the dashboard too, and isolated per environment', async () => {
      const dashboard = (await asUser(owner, `${env(owner)}/events`)).json();
      expect(dashboard.data).toHaveLength(3);
      expect((await asKey('/v1/events', prodKey)).json().data).toHaveLength(0);
      expect((await asUser(outsider, `${env(owner)}/events`)).statusCode).toBe(404);
    });
  });

  it('lets the dashboard send a test event (session + trusted origin)', async () => {
    const send = (origin: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/environments/${owner.productionEnvId}/events`,
        headers: { cookie: owner.cookie, origin },
        payload: { type: 'relay.test', data: {} },
      });
    expect((await send('https://evil.example')).statusCode).toBe(403);
    const res = await send(ORIGIN);
    expect(res.statusCode).toBe(202);
    expect((await asKey(`/v1/events/${res.json().id}`, prodKey)).statusCode).toBe(200);
  });

  it('GET /v1/events/:id returns the payload and one row per endpoint', async () => {
    const res = await asKey(`/v1/events/${sent[0]!.id}`);
    expect(res.statusCode).toBe(200);
    const event = res.json();
    expect(event).toMatchObject({ id: sent[0]!.id, type: 'invoice.paid', data: { n: 0 } });
    expect(event.deliveries.map((d: { endpointId: string }) => d.endpointId).sort()).toEqual(
      [endpointA, endpointB].sort(),
    );
    expect(event.deliveries[0]).toMatchObject({
      endpointUrl: expect.stringMatching(/^https:\/\/[ab]\.example\.com\/hooks$/),
      status: 'pending',
      attemptCount: 0,
    });

    expect((await asKey(`/v1/events/${sent[0]!.id}`, prodKey)).statusCode).toBe(404);
    expect((await asKey(`/v1/events/${newId('event')}`)).statusCode).toBe(404);
  });

  describe('deliveries', () => {
    it('lists with filters', async () => {
      const all = (await asKey('/v1/deliveries')).json();
      expect(all.data).toHaveLength(5); // 2 + 1 + 2
      expect(all.data[0]).toMatchObject({
        eventType: expect.any(String),
        endpointUrl: expect.any(String),
        status: 'pending',
      });

      const forB = (await asKey(`/v1/deliveries?endpointId=${endpointB}`)).json();
      expect(forB.data).toHaveLength(2);
      const forEvent = (await asKey(`/v1/deliveries?eventId=${sent[1]!.id}`)).json();
      expect(forEvent.data).toHaveLength(1);

      const [one] = forEvent.data;
      await db.update(deliveries).set({ status: 'failed' }).where(eq(deliveries.id, one.id));
      const failed = (await asKey('/v1/deliveries?status=failed')).json();
      expect(failed.data.map((d: { id: string }) => d.id)).toEqual([one.id]);

      expect((await asKey('/v1/deliveries?status=lost')).statusCode).toBe(422);
    });

    it('GET /v1/deliveries/:id shows the exact body and every attempt in order', async () => {
      const [delivery] = (await asKey(`/v1/deliveries?eventId=${sent[2]!.id}`)).json().data;
      for (const [n, statusCode, errorCode] of [
        [2, 200, null],
        [1, null, 'timeout'],
      ] as const) {
        await db.insert(deliveryAttempts).values({
          id: newId('attempt'),
          organizationId: owner.organizationId,
          deliveryId: delivery.id,
          attemptNumber: n,
          statusCode,
          errorCode,
          durationMs: 120,
          requestHeaders: { 'x-secret': '[redacted]' },
          responseBody: statusCode ? 'ok' : null,
        });
      }

      const res = await asUser(owner, `${env(owner)}/deliveries/${delivery.id}`);
      expect(res.statusCode).toBe(200);
      const detail = res.json();
      expect(detail.attempts.map((a: { attemptNumber: number }) => a.attemptNumber)).toEqual([
        1, 2,
      ]);
      expect(detail.attempts[0]).toMatchObject({ statusCode: null, errorCode: 'timeout' });
      expect(detail.attempts[1]).toMatchObject({ statusCode: 200, responseBody: 'ok' });

      const event = (await asKey(`/v1/events/${sent[2]!.id}`)).json();
      expect(detail.requestBody).toBe(
        webhookBody({ type: event.type, createdAt: new Date(event.createdAt), data: event.data }),
      );

      expect((await asKey(`/v1/deliveries/${delivery.id}`, prodKey)).statusCode).toBe(404);
      expect(
        (await asUser(outsider, `${env(outsider)}/deliveries/${delivery.id}`)).statusCode,
      ).toBe(404);
    });

    describe('replay', () => {
      const replay = (id: string, headers: Record<string, string>) =>
        app.inject({ method: 'POST', url: id, headers });
      const asOwner = { cookie: '', origin: ORIGIN };

      async function finishedDelivery(status: 'failed' | 'succeeded' = 'failed') {
        const [d] = (await asKey(`/v1/deliveries?eventId=${sent[0]!.id}&limit=1`)).json().data;
        await db
          .update(deliveries)
          .set({ status, nextAttemptAt: null })
          .where(eq(deliveries.id, d.id));
        await db.delete(queueJobs).where(eq(queueJobs.dedupeKey, d.id));
        return d as { id: string; endpointId: string };
      }

      it('re-queues a finished delivery as one manual attempt', async () => {
        const d = await finishedDelivery('failed');
        asOwner.cookie = owner.cookie;
        const res = await replay(`${env(owner)}/deliveries/${d.id}/replay`, asOwner);
        expect(res.statusCode).toBe(202);
        expect(res.json()).toMatchObject({ id: d.id, status: 'pending' });

        const jobs = await db.select().from(queueJobs).where(eq(queueJobs.dedupeKey, d.id));
        expect(jobs).toHaveLength(1);
        expect(jobs[0]!.payload).toEqual({ deliveryId: d.id, trigger: 'manual' });

        // Now scheduled: a second replay is refused instead of double-sending.
        const again = await replay(`${env(owner)}/deliveries/${d.id}/replay`, asOwner);
        expect(again.statusCode).toBe(409);
      });

      it('works with an API key too, including for succeeded deliveries', async () => {
        const d = await finishedDelivery('succeeded');
        const res = await replay(`/v1/deliveries/${d.id}/replay`, {
          authorization: `Bearer ${devKey}`,
        });
        expect(res.statusCode).toBe(202);
      });

      it('refuses while the endpoint is paused', async () => {
        const d = await finishedDelivery('failed');
        await db.update(endpoints).set({ status: 'paused' }).where(eq(endpoints.id, d.endpointId));
        try {
          const res = await replay(`/v1/deliveries/${d.id}/replay`, {
            authorization: `Bearer ${devKey}`,
          });
          expect(res.statusCode).toBe(409);
          expect(res.json().detail).toMatch(/paused/);
        } finally {
          await db
            .update(endpoints)
            .set({ status: 'active' })
            .where(eq(endpoints.id, d.endpointId));
        }
      });

      it('is scoped like every other route', async () => {
        const d = await finishedDelivery('failed');
        const cross = await replay(`/v1/deliveries/${d.id}/replay`, {
          authorization: `Bearer ${prodKey}`,
        });
        expect(cross.statusCode).toBe(404);
        const csrf = await replay(`${env(owner)}/deliveries/${d.id}/replay`, {
          cookie: owner.cookie,
          origin: 'https://evil.example',
        });
        expect(csrf.statusCode).toBe(403);
      });
    });
  });
});
