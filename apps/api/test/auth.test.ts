import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  type Database,
  type DatabaseHandle,
  environments,
  eq,
  members,
  organizations,
  users,
} from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { isId, newId } from '@relay/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureDefaultOrganization, slugify } from '../src/auth/provisioning.js';
import { boot, cookieHeader, ORIGIN } from './helpers.js';

describe('Authentication & workspace provisioning', () => {
  let app: NestFastifyApplication;
  let database: DatabaseHandle;
  let db: Database;

  beforeAll(async () => {
    database = await createTestDb();
    db = database.db;
    app = await boot(database);
  });
  afterAll(async () => {
    await app.close();
  });

  async function signUp(email: string, name = 'Ada Lovelace', password = 'correct-horse-battery') {
    return app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: { origin: ORIGIN },
      payload: { email, name, password },
    });
  }

  async function workspaceOf(userId: string) {
    const memberships = await db.select().from(members).where(eq(members.userId, userId));
    const orgId = memberships[0]?.organizationId ?? '';
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    const envs = await db.select().from(environments).where(eq(environments.organizationId, orgId));
    return { memberships, org, envs };
  }

  it('sign-up creates the user, an owned organization and both environments', async () => {
    const res = await signUp('ada@example.com');
    expect(res.statusCode).toBe(200);

    const { user } = res.json();
    expect(isId(user.id, 'user')).toBe(true);
    expect(cookieHeader(res)).toContain('relay.session_token=');

    const { memberships, org, envs } = await workspaceOf(user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: 'owner' });
    expect(isId(memberships[0]!.id, 'membership')).toBe(true);
    expect(org).toMatchObject({ name: "Ada's Workspace" });
    expect(org!.slug).toMatch(/^ada-s-workspace-[0-9a-z]{6}$/);
    expect(envs.map((e) => [e.name, e.kind]).sort()).toEqual([
      ['Development', 'development'],
      ['Production', 'production'],
    ]);
    expect(envs.every((e) => isId(e.id, 'environment'))).toBe(true);
  });

  it('GET /v1/me returns the user, the active org and its environments', async () => {
    const res = await signUp('grace@example.com', 'Grace Hopper');
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: cookieHeader(res) },
    });

    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.user).toMatchObject({ email: 'grace@example.com', name: 'Grace Hopper' });
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0]).toMatchObject({ name: "Grace's Workspace", role: 'owner' });
    expect(body.organizations[0].environments.map((e: { kind: string }) => e.kind)).toEqual([
      'development',
      'production',
    ]);
    expect(body.activeOrganizationId).toBe(body.organizations[0].id);
  });

  it('GET /v1/me without a session → 401 problem details', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 401, title: 'Unauthorized' });
  });

  it('GET /v1/me with a forged session cookie → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: 'relay.session_token=forged.token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('sign-in works with the right password, never re-provisions, and rejects a wrong one', async () => {
    const created = await signUp('linus@example.com', 'Linus');
    const userId = created.json().user.id;

    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/sign-in/email',
      headers: { origin: ORIGIN },
      payload: { email: 'linus@example.com', password: 'not-the-password' },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'POST',
      url: '/auth/sign-in/email',
      headers: { origin: ORIGIN },
      payload: { email: 'linus@example.com', password: 'correct-horse-battery' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await workspaceOf(userId)).memberships).toHaveLength(1);
  });

  it('rejects a duplicate email without creating a second workspace', async () => {
    await signUp('dup@example.com');
    const again = await signUp('dup@example.com');
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
    expect(again.statusCode).toBeLessThan(500);

    const rows = await db.select().from(users).where(eq(users.email, 'dup@example.com'));
    expect(rows).toHaveLength(1);
  });

  it('rejects passwords shorter than 10 characters', async () => {
    const res = await signUp('short@example.com', 'Short', 'abc123');
    expect(res.statusCode).toBe(400);
  });

  it('rejects sign-up from an untrusted origin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'csrf@example.com', name: 'Mallory', password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(403);
    expect(await db.select().from(users).where(eq(users.email, 'csrf@example.com'))).toEqual([]);
  });

  it('rejects a cross-site request riding on a victim session cookie (CSRF)', async () => {
    const victim = await signUp('victim@example.com', 'Victim');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-out',
      headers: { origin: 'https://evil.example', cookie: cookieHeader(victim) },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('blocks cross-site navigation logins (Fetch Metadata)', async () => {
    await signUp('nav@example.com', 'Nav');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-in/email',
      headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
      payload: { email: 'nav@example.com', password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('provisioning is idempotent under concurrent calls', async () => {
    // A user with no workspace (e.g. the sign-up hook crashed mid-way).
    const userId = newId('user');
    await db.insert(users).values({ id: userId, name: 'Orphan', email: 'orphan@example.com' });

    const ids = await Promise.all(
      Array.from({ length: 5 }, () => ensureDefaultOrganization(db, userId)),
    );

    expect(new Set(ids).size).toBe(1);
    const { memberships, envs } = await workspaceOf(userId);
    expect(memberships).toHaveLength(1);
    expect(envs).toHaveLength(2);
  });
});

describe('slugify', () => {
  it('produces URL-safe slugs with a random suffix', () => {
    expect(slugify("Ada's Workspace")).toMatch(/^ada-s-workspace-[0-9a-z]{6}$/);
    expect(slugify('Café  Crème!')).toMatch(/^cafe-creme-[0-9a-z]{6}$/);
  });

  it('falls back when nothing usable remains', () => {
    expect(slugify('日本語')).toMatch(/^workspace-[0-9a-z]{6}$/);
  });

  it('never repeats for the same name', () => {
    expect(slugify('Acme')).not.toBe(slugify('Acme'));
  });
});
