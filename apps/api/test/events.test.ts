import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  apiKeys,
  type Database,
  type DatabaseHandle,
  deliveries,
  endpoints,
  eq,
  events,
  inArray,
  queueJobs,
} from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { newId, QUEUES } from '@relay/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateApiKey } from '../src/api-keys/api-key.js';
import { boot, ORIGIN, signUpUser, type TestUser } from './helpers.js';

describe('POST /v1/events', () => {
  let app: NestFastifyApplication;
  let database: DatabaseHandle;
  let db: Database;
  let user: TestUser;
  let devKey: string;
  let prodKey: string;
  const ep: Record<string, string> = {};

  async function createKey(envId: string): Promise<{ id: string; key: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/environments/${envId}/api-keys`,
      headers: { cookie: user.cookie, origin: ORIGIN },
      payload: { name: 'test' },
    });
    return res.json();
  }

  async function addEndpoint(
    name: string,
    environmentId: string,
    extra: Partial<typeof endpoints.$inferInsert> = {},
  ) {
    ep[name] = newId('endpoint');
    await db.insert(endpoints).values({
      id: ep[name],
      organizationId: user.organizationId,
      environmentId,
      url: `https://example.com/hooks/${name}`,
      signingSecret: 'whsec_test',
      ...extra,
    });
  }

  function send(
    payload: unknown,
    { key = devKey, idempotencyKey }: { key?: string; idempotencyKey?: string } = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: {
        authorization: `Bearer ${key}`,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      payload: payload as object,
    });
  }

  const deliveriesOf = (eventId: string) =>
    db.select().from(deliveries).where(eq(deliveries.eventId, eventId));

  beforeAll(async () => {
    database = await createTestDb();
    db = database.db;
    app = await boot(database);
    user = await signUpUser(app, 'producer@example.com');
    devKey = (await createKey(user.developmentEnvId)).key;
    prodKey = (await createKey(user.productionEnvId)).key;

    const dev = user.developmentEnvId;
    await addEndpoint('all', dev); // no filter → every type
    await addEndpoint('invoices', dev, { filterEventTypes: ['invoice.paid', 'invoice.voided'] });
    await addEndpoint('users', dev, { filterEventTypes: ['user.created'] });
    await addEndpoint('paused', dev, { status: 'paused' });
    await addEndpoint('prod', user.productionEnvId);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('authentication', () => {
    it('401 without a key, with a WWW-Authenticate challenge', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/events', payload: {} });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toContain('Bearer');
      expect(res.headers['content-type']).toContain('application/problem+json');
    });

    it('401 for malformed and unknown keys', async () => {
      const event = { type: 'a.b', data: {} };
      expect((await send(event, { key: 'not-a-key' })).statusCode).toBe(401);
      expect((await send(event, { key: generateApiKey('test').key })).statusCode).toBe(401);
    });

    it('401 for a revoked key', async () => {
      const { id, key } = await createKey(user.developmentEnvId);
      await app.inject({
        method: 'DELETE',
        url: `/v1/environments/${user.developmentEnvId}/api-keys/${id}`,
        headers: { cookie: user.cookie, origin: ORIGIN },
      });
      expect((await send({ type: 'a.b', data: {} }, { key })).statusCode).toBe(401);
    });

    it('401 for an expired key', async () => {
      const { key, keyPrefix, keyHash } = generateApiKey('test');
      await db.insert(apiKeys).values({
        id: newId('apiKey'),
        organizationId: user.organizationId,
        environmentId: user.developmentEnvId,
        name: 'expired',
        keyPrefix,
        keyHash,
        expiresAt: new Date(Date.now() - 1000),
      });
      expect((await send({ type: 'a.b', data: {} }, { key })).statusCode).toBe(401);
    });

    it('records when a key was last used', async () => {
      const { id, key } = await createKey(user.developmentEnvId);
      await send({ type: 'ping', data: {} }, { key });
      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
      expect(row!.lastUsedAt).toBeInstanceOf(Date);
    });
  });

  describe('fan-out', () => {
    it('202 → stores the event and schedules one delivery per subscribed endpoint', async () => {
      const res = await send({ type: 'invoice.paid', data: { invoiceId: 'inv_1', amount: 4200 } });
      expect(res.statusCode).toBe(202);

      const body = res.json();
      expect(body).toMatchObject({
        type: 'invoice.paid',
        data: { invoiceId: 'inv_1', amount: 4200 },
        idempotencyKey: null,
      });
      expect(body.id).toMatch(/^evt_/);

      const rows = await deliveriesOf(body.id);
      // Not `users` (filtered), `paused` (inactive) or `prod` (other environment).
      expect(rows.map((d) => d.endpointId).sort()).toEqual([ep.all, ep.invoices].sort());
      expect(
        rows.every((d) => d.status === 'pending' && d.environmentId === user.developmentEnvId),
      ).toBe(true);

      const jobs = await db
        .select()
        .from(queueJobs)
        .where(
          inArray(
            queueJobs.dedupeKey,
            rows.map((d) => d.id),
          ),
        );
      expect(jobs).toHaveLength(2);
      for (const job of jobs) {
        expect(job.queue).toBe(QUEUES.delivery);
        expect(job.status).toBe('pending');
        expect(job.payload).toEqual({ deliveryId: job.dedupeKey });
      }
    });

    it('routes by event type', async () => {
      const res = await send({ type: 'user.created', data: { userId: 'u_1' } });
      const rows = await deliveriesOf(res.json().id);
      expect(rows.map((d) => d.endpointId).sort()).toEqual([ep.all, ep.users].sort());
    });

    it("fans out only within the API key's environment", async () => {
      const res = await send({ type: 'invoice.paid', data: {} }, { key: prodKey });
      expect(res.statusCode).toBe(202);
      expect((await deliveriesOf(res.json().id)).map((d) => d.endpointId)).toEqual([ep.prod]);
    });

    it('is atomic: if scheduling fails, nothing is stored', async () => {
      // Make every queue insert fail, simulating a crash mid-transaction.
      await database.sql.query(
        'ALTER TABLE queue_jobs ADD CONSTRAINT test_reject_all CHECK (false) NOT VALID',
      );
      try {
        const res = await send(
          { type: 'invoice.paid', data: { n: 1 } },
          { idempotencyKey: 'atomicity-check' },
        );
        expect(res.statusCode).toBe(500);
        expect(res.body).not.toContain('test_reject_all'); // no internals leaked
      } finally {
        await database.sql.query('ALTER TABLE queue_jobs DROP CONSTRAINT test_reject_all');
      }

      const stored = await db
        .select()
        .from(events)
        .where(eq(events.idempotencyKey, 'atomicity-check'));
      expect(stored).toEqual([]); // event rolled back together with its deliveries

      // ...so the producer's retry (same key) goes through cleanly.
      const retry = await send(
        { type: 'invoice.paid', data: { n: 1 } },
        { idempotencyKey: 'atomicity-check' },
      );
      expect(retry.statusCode).toBe(202);
      expect(retry.headers['idempotent-replayed']).toBeUndefined();
      expect(await deliveriesOf(retry.json().id)).toHaveLength(2);
    });
  });

  describe('idempotency', () => {
    it('replays the original event for a repeated Idempotency-Key', async () => {
      const event = { type: 'invoice.paid', data: { invoiceId: 'inv_2' } };
      const first = await send(event, { idempotencyKey: 'order-42' });
      const second = await send(event, { idempotencyKey: 'order-42' });

      expect(second.statusCode).toBe(202);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(second.json()).toEqual(first.json());
      expect(await deliveriesOf(first.json().id)).toHaveLength(2); // no duplicates
    });

    it('treats JSON key order as irrelevant when comparing bodies', async () => {
      await send({ type: 't.x', data: { a: 1, b: { c: 2, d: 3 } } }, { idempotencyKey: 'order' });
      const again = await send(
        { type: 't.x', data: { b: { d: 3, c: 2 }, a: 1 } },
        { idempotencyKey: 'order' },
      );
      expect(again.headers['idempotent-replayed']).toBe('true');
    });

    it('409 when a key is reused with a different body', async () => {
      await send({ type: 'invoice.paid', data: { v: 1 } }, { idempotencyKey: 'reused' });
      const res = await send(
        { type: 'invoice.paid', data: { v: 2 } },
        { idempotencyKey: 'reused' },
      );
      expect(res.statusCode).toBe(409);
    });

    it('scopes keys per environment', async () => {
      const event = { type: 'invoice.paid', data: {} };
      const dev = await send(event, { idempotencyKey: 'shared-key' });
      const prod = await send(event, { idempotencyKey: 'shared-key', key: prodKey });
      expect(prod.headers['idempotent-replayed']).toBeUndefined();
      expect(prod.json().id).not.toBe(dev.json().id);
    });

    it('creates exactly one event under concurrent retries', async () => {
      const event = { type: 'invoice.paid', data: { race: true } };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => send(event, { idempotencyKey: 'race' })),
      );
      expect(results.every((r) => r.statusCode === 202)).toBe(true);
      expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
      expect(results.filter((r) => !r.headers['idempotent-replayed'])).toHaveLength(1);
    });
  });

  describe('validation', () => {
    it('422 with field errors for an invalid event', async () => {
      const res = await send({ type: 'bad type!', data: [1, 2] });
      expect(res.statusCode).toBe(422);
      expect(
        res
          .json()
          .errors.map((e: { path: string }) => e.path)
          .sort(),
      ).toEqual(['data', 'type']);
    });

    it('400 for an invalid Idempotency-Key', async () => {
      const res = await send({ type: 'a.b', data: {} }, { idempotencyKey: 'x'.repeat(256) });
      expect(res.statusCode).toBe(400);
    });
  });
});
