import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type Database, notifications } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { newId } from '@relay/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ORIGIN, signUpUser, type TestUser } from './helpers.js';

describe('notifications', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let owner: TestUser;
  let outsider: TestUser;
  const ids: string[] = [];

  const base = (user: TestUser, envId = user.developmentEnvId) =>
    `/v1/environments/${envId}/notifications`;
  const get = (user: TestUser, url: string) =>
    app.inject({ method: 'GET', url, headers: { cookie: user.cookie } });
  const markRead = (user: TestUser, payload: object = {}, origin = ORIGIN) =>
    app.inject({
      method: 'POST',
      url: `${base(user)}/read`,
      headers: { cookie: user.cookie, origin },
      payload,
    });

  beforeAll(async () => {
    const database = await createTestDb();
    db = database.db;
    app = await boot(database);
    owner = await signUpUser(app, 'alerts@example.com');
    outsider = await signUpUser(app, 'other@example.com');

    for (const kind of ['endpoint_failing', 'endpoint_recovered', 'endpoint_disabled'] as const) {
      const id = newId('notification');
      ids.push(id);
      await db.insert(notifications).values({
        id,
        organizationId: owner.organizationId,
        environmentId: owner.developmentEnvId,
        endpointUrl: 'https://example.com/hooks',
        kind,
        title: `title ${kind}`,
        body: 'body',
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists newest first with the unread count', async () => {
    const res = await get(owner, base(owner));
    expect(res.statusCode).toBe(200);
    const page = res.json();
    expect(page.unreadCount).toBe(3);
    expect(page.data.map((n: { id: string }) => n.id)).toEqual([...ids].sort().reverse());
    expect(page.data[0]).toMatchObject({ readAt: null, endpointUrl: 'https://example.com/hooks' });
  });

  it('marks selected notifications read, then all; idempotently', async () => {
    expect((await markRead(owner, { ids: [ids[0]] })).json()).toEqual({ updated: 1 });
    expect((await get(owner, base(owner))).json().unreadCount).toBe(2);
    const unreadOnly = (await get(owner, `${base(owner)}?unread=true`)).json();
    expect(unreadOnly.data.map((n: { id: string }) => n.id)).not.toContain(ids[0]);

    expect((await markRead(owner)).json()).toEqual({ updated: 2 });
    expect((await markRead(owner)).json()).toEqual({ updated: 0 });
    expect((await get(owner, base(owner))).json().unreadCount).toBe(0);
  });

  it('is scoped to the environment and protected like every route', async () => {
    expect((await get(owner, base(owner, owner.productionEnvId))).json().data).toHaveLength(0);
    expect((await get(outsider, base(owner))).statusCode).toBe(404);
    // Another tenant can't mark these read by id.
    expect((await markRead(outsider, { ids })).json()).toEqual({ updated: 0 });
    expect((await markRead(owner, {}, 'https://evil.example')).statusCode).toBe(403);
  });
});
