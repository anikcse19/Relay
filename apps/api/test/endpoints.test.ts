import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  type Database,
  type DatabaseHandle,
  deliveries,
  endpoints,
  eq,
  events,
  members,
  queueJobs,
} from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { newId } from '@relay/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ORIGIN, signUpUser, type TestUser } from './helpers.js';

describe('endpoints', () => {
  let app: NestFastifyApplication;
  let database: DatabaseHandle;
  let db: Database;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let devKey: string;

  const base = (user: TestUser, envId = user.developmentEnvId) =>
    `/v1/environments/${envId}/endpoints`;

  /** Dashboard-style request: session cookie + trusted Origin. */
  function asUser(
    user: TestUser,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) {
    return app.inject({
      method,
      url,
      headers: { cookie: user.cookie, origin: ORIGIN },
      ...(payload && { payload }),
    });
  }

  /** Programmatic request with an API key. */
  function asKey(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
    return app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${devKey}` },
      ...(payload && { payload }),
    });
  }

  async function createEndpoint(payload: object = { url: 'https://example.com/hooks' }) {
    const res = await asUser(owner, 'POST', base(owner), payload);
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  beforeAll(async () => {
    database = await createTestDb();
    db = database.db;
    app = await boot(database);
    owner = await signUpUser(app, 'owner@example.com');
    member = await signUpUser(app, 'member@example.com');
    outsider = await signUpUser(app, 'outsider@example.com');
    // Make `member` a plain member of the owner's organization.
    await db.insert(members).values({
      id: newId('membership'),
      organizationId: owner.organizationId,
      userId: member.userId,
      role: 'member',
    });
    const key = await asUser(owner, 'POST', `/v1/environments/${owner.developmentEnvId}/api-keys`, {
      name: 'ci',
    });
    devKey = key.json().key;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create', () => {
    it('returns the signing secret once and never exposes it again', async () => {
      const created = await createEndpoint({
        url: 'https://Example.com/hooks#ignored',
        description: 'Billing service',
        filterEventTypes: ['invoice.paid', 'invoice.created', 'invoice.paid'],
        headers: { Authorization: 'Bearer receiver-token' },
      });
      expect(created).toMatchObject({
        id: expect.stringMatching(/^ep_/),
        url: 'https://example.com/hooks',
        description: 'Billing service',
        status: 'active',
        filterEventTypes: ['invoice.created', 'invoice.paid'], // de-duplicated, sorted
        headerNames: ['Authorization'],
        signingSecret: expect.stringMatching(/^whsec_/),
      });
      expect(created).not.toHaveProperty('headers');

      const fetched = await asUser(owner, 'GET', `${base(owner)}/${created.id}`);
      expect(fetched.statusCode).toBe(200);
      expect(fetched.body).not.toContain(created.signingSecret);
      expect(fetched.body).not.toContain('receiver-token');
      expect(fetched.json()).not.toHaveProperty('signingSecret');
    });

    it('rejects reserved and malformed headers with field-level errors', async () => {
      const res = await asUser(owner, 'POST', base(owner), {
        url: 'https://example.com/hooks',
        headers: { 'Webhook-Signature': 'forged', 'X-Ok': 'line\r\nInjected: 1' },
      });
      expect(res.statusCode).toBe(422);
      const paths = res.json().errors.map((e: { path: string }) => e.path);
      expect(paths).toEqual(expect.arrayContaining(['headers.Webhook-Signature', 'headers.X-Ok']));
    });

    it('reports a disallowed URL on the url field', async () => {
      const res = await asUser(owner, 'POST', base(owner), { url: 'ftp://example.com' });
      expect(res.statusCode).toBe(422);
      expect(res.json().errors).toEqual([
        { path: 'url', message: expect.stringMatching(/http or https/) },
      ]);
    });

    it('requires the owner or admin role in the dashboard', async () => {
      const res = await asUser(member, 'POST', base(owner), { url: 'https://example.com/m' });
      expect(res.statusCode).toBe(403);
    });

    it('blocks cross-origin dashboard writes (CSRF)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: base(owner),
        headers: { cookie: owner.cookie, origin: 'https://evil.example' },
        payload: { url: 'https://example.com/hooks' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('access', () => {
    it('lets members read', async () => {
      const res = await asUser(member, 'GET', base(owner));
      expect(res.statusCode).toBe(200);
    });

    it('returns 404 for environments the user does not belong to', async () => {
      expect((await asUser(outsider, 'GET', base(owner))).statusCode).toBe(404);
      const ep = await createEndpoint();
      expect((await asUser(outsider, 'GET', `${base(outsider)}/${ep.id}`)).statusCode).toBe(404);
    });

    it('scopes an endpoint to its environment', async () => {
      const ep = await createEndpoint();
      const res = await asUser(owner, 'GET', `${base(owner, owner.productionEnvId)}/${ep.id}`);
      expect(res.statusCode).toBe(404);
    });

    it('serves the same resource to API keys at /v1/endpoints', async () => {
      const created = await asKey('POST', '/v1/endpoints', { url: 'https://example.com/api' });
      expect(created.statusCode).toBe(201);
      const { id } = created.json();

      const listed = await asKey('GET', '/v1/endpoints?limit=100');
      expect(listed.json().data.map((e: { id: string }) => e.id)).toContain(id);
      // ...and it's the same environment the dashboard sees.
      expect((await asUser(owner, 'GET', `${base(owner)}/${id}`)).statusCode).toBe(200);
    });

    it('never falls back from one credential to the other', async () => {
      // An API key on the dashboard path is not a session.
      const keyOnSessionPath = await app.inject({
        method: 'GET',
        url: base(owner),
        headers: { authorization: `Bearer ${devKey}` },
      });
      expect(keyOnSessionPath.statusCode).toBe(401);
      // A session cookie on the API path is not an API key.
      const cookieOnKeyPath = await app.inject({
        method: 'GET',
        url: '/v1/endpoints',
        headers: { cookie: owner.cookie },
      });
      expect(cookieOnKeyPath.statusCode).toBe(401);
    });
  });

  it('paginates newest first with a cursor', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await createEndpoint()).id);

    const first = (await asUser(owner, 'GET', `${base(owner)}?limit=2`)).json();
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).toBe(first.data[1].id);
    const second = (
      await asUser(owner, 'GET', `${base(owner)}?limit=2&cursor=${first.nextCursor}`)
    ).json();
    const all = [...first.data, ...second.data].map((e: { id: string }) => e.id);
    expect(new Set(all).size).toBe(all.length); // no duplicates across pages
    // Ids are the sort key (two created in the same millisecond order by their random part).
    expect(all.slice(0, 3)).toEqual([...ids].sort().reverse());

    const bad = await asUser(owner, 'GET', `${base(owner)}?cursor=nope`);
    expect(bad.statusCode).toBe(422);
  });

  it('rotates the secret and keeps the old one valid for a grace period', async () => {
    const ep = await createEndpoint();
    const res = await asUser(owner, 'POST', `${base(owner)}/${ep.id}/rotate-secret`);
    expect(res.statusCode).toBe(200);
    const rotated = res.json();
    expect(rotated.signingSecret).toMatch(/^whsec_/);
    expect(rotated.signingSecret).not.toBe(ep.signingSecret);

    const hoursLeft = (Date.parse(rotated.previousSecretExpiresAt) - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24);

    const [row] = await db.select().from(endpoints).where(eq(endpoints.id, ep.id));
    expect(row!.previousSigningSecret).toBe(ep.signingSecret);
    expect(row!.signingSecret).toBe(rotated.signingSecret);
  });

  describe('update', () => {
    it('updates fields and replaces headers', async () => {
      const ep = await createEndpoint({ url: 'https://example.com/a', headers: { 'X-A': '1' } });
      const res = await asUser(owner, 'PATCH', `${base(owner)}/${ep.id}`, {
        url: 'https://example.com/b',
        description: null,
        filterEventTypes: null,
        headers: { 'X-B': '2' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        url: 'https://example.com/b',
        description: null,
        filterEventTypes: null,
        headerNames: ['X-B'],
      });
    });

    it('re-enabling an auto-disabled endpoint resets its health', async () => {
      const ep = await createEndpoint();
      expect(ep.health).toEqual({
        consecutiveFailures: 0,
        failingSince: null,
        circuitOpenUntil: null,
        lastSuccessAt: null,
      });
      // As the worker leaves it after days of failures.
      await db
        .update(endpoints)
        .set({
          status: 'disabled',
          disabledReason: 'Disabled automatically: every delivery failed for 5 days.',
          consecutiveFailures: 120,
          failingSince: new Date(Date.now() - 6 * 24 * 3_600_000),
          circuitOpenUntil: new Date(Date.now() + 600_000),
        })
        .where(eq(endpoints.id, ep.id));

      const listed = (await asUser(owner, 'GET', `${base(owner)}/${ep.id}`)).json();
      expect(listed).toMatchObject({ status: 'disabled', health: { consecutiveFailures: 120 } });
      expect(listed.health.circuitOpenUntil).not.toBeNull();

      const res = await asUser(owner, 'PATCH', `${base(owner)}/${ep.id}`, { status: 'active' });
      expect(res.json()).toMatchObject({
        status: 'active',
        disabledReason: null,
        health: { consecutiveFailures: 0, failingSince: null, circuitOpenUntil: null },
      });
    });

    it('rejects an empty update', async () => {
      const ep = await createEndpoint();
      expect((await asUser(owner, 'PATCH', `${base(owner)}/${ep.id}`, {})).statusCode).toBe(422);
    });

    it('re-queues held deliveries when a paused endpoint is resumed', async () => {
      const ep = await createEndpoint();
      expect(
        (await asUser(owner, 'PATCH', `${base(owner)}/${ep.id}`, { status: 'paused' })).json()
          .status,
      ).toBe('paused');

      // A delivery that was pending when the endpoint was paused: the worker
      // acked its job ("held") and left the row pending.
      const eventId = newId('event');
      await db.insert(events).values({
        id: eventId,
        organizationId: owner.organizationId,
        environmentId: owner.developmentEnvId,
        eventType: 'order.created',
        payload: {},
      });
      const deliveryId = newId('delivery');
      await db.insert(deliveries).values({
        id: deliveryId,
        organizationId: owner.organizationId,
        environmentId: owner.developmentEnvId,
        eventId,
        endpointId: ep.id,
        status: 'pending',
      });

      const resumed = await asUser(owner, 'PATCH', `${base(owner)}/${ep.id}`, { status: 'active' });
      expect(resumed.json().status).toBe('active');
      const jobs = await db.select().from(queueJobs).where(eq(queueJobs.dedupeKey, deliveryId));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.payload).toEqual({ deliveryId });

      // Resuming twice doesn't duplicate jobs.
      await asUser(owner, 'PATCH', `${base(owner)}/${ep.id}`, { status: 'paused' });
      await asUser(owner, 'PATCH', `${base(owner)}/${ep.id}`, { status: 'active' });
      expect(
        await db.select().from(queueJobs).where(eq(queueJobs.dedupeKey, deliveryId)),
      ).toHaveLength(1);
    });
  });

  it('deletes an endpoint', async () => {
    const ep = await createEndpoint();
    expect((await asUser(owner, 'DELETE', `${base(owner)}/${ep.id}`)).statusCode).toBe(204);
    expect((await asUser(owner, 'GET', `${base(owner)}/${ep.id}`)).statusCode).toBe(404);
    expect((await asUser(owner, 'DELETE', `${base(owner)}/${ep.id}`)).statusCode).toBe(404);
  });
});

describe('endpoints with the strict URL policy', () => {
  let app: NestFastifyApplication;
  let owner: TestUser;

  beforeAll(async () => {
    app = await boot(await createTestDb(), { ENDPOINT_URL_POLICY: 'strict' });
    owner = await signUpUser(app, 'strict@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    'http://93.184.215.14/hooks',
    'https://localhost/hooks',
    'https://127.0.0.1/hooks',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hooks',
  ])('rejects %s', async (url) => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/environments/${owner.developmentEnvId}/endpoints`,
      headers: { cookie: owner.cookie, origin: ORIGIN },
      payload: { url },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].path).toBe('url');
  });

  it('accepts a public https address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/environments/${owner.developmentEnvId}/endpoints`,
      headers: { cookie: owner.cookie, origin: ORIGIN },
      payload: { url: 'https://93.184.215.14/hooks' },
    });
    expect(res.statusCode).toBe(201);
  });
});
