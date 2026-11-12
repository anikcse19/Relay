import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { apiKeys, type Database, eq, members } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { newId } from '@relay/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_KEY_PATTERN,
  generateApiKey,
  hashApiKey,
  parseBearerKey,
} from '../src/api-keys/api-key.js';
import { boot, ORIGIN, signUpUser, type TestUser } from './helpers.js';

describe('API key primitives', () => {
  it('generates well-formed, unique keys with a display prefix', () => {
    const a = generateApiKey('live');
    const b = generateApiKey('live');
    expect(a.key).toMatch(API_KEY_PATTERN);
    expect(a.key.startsWith('rk_live_')).toBe(true);
    expect(a.keyPrefix).toBe(a.key.slice(0, 14));
    expect(a.keyHash).toBe(hashApiKey(a.key));
    expect(a.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.key).not.toBe(b.key);
  });

  it('only accepts well-formed bearer keys', () => {
    const { key } = generateApiKey('test');
    expect(parseBearerKey(`Bearer ${key}`)).toBe(key);
    expect(parseBearerKey(`bearer   ${key}`)).toBe(key);
    expect(parseBearerKey(key)).toBeUndefined(); // no scheme
    expect(parseBearerKey('Bearer rk_test_short')).toBeUndefined();
    expect(parseBearerKey(`Basic ${key}`)).toBeUndefined();
    expect(parseBearerKey(undefined)).toBeUndefined();
  });
});

describe('API key management', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let owner: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    const database = await createTestDb();
    db = database.db;
    app = await boot(database);
    owner = await signUpUser(app, 'owner@example.com');
    stranger = await signUpUser(app, 'stranger@example.com');
  });
  afterAll(async () => {
    await app.close();
  });

  const keysUrl = (envId: string) => `/v1/environments/${envId}/api-keys`;

  function createKey(user: TestUser, envId: string, payload: object = { name: 'CI' }) {
    return app.inject({
      method: 'POST',
      url: keysUrl(envId),
      headers: { cookie: user.cookie, origin: ORIGIN },
      payload,
    });
  }

  it('creates a key, returns the secret once, and stores only its hash', async () => {
    const res = await createKey(owner, owner.productionEnvId, { name: 'Production server' });
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.key).toMatch(/^rk_live_/); // production → live
    expect(body).toMatchObject({ name: 'Production server', revokedAt: null, expiresAt: null });
    expect(body).not.toHaveProperty('keyHash');

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, body.id));
    expect(row!.keyHash).toBe(hashApiKey(body.key));
    expect(JSON.stringify(row)).not.toContain(body.key);
  });

  it('uses test keys for development environments', async () => {
    const res = await createKey(owner, owner.developmentEnvId);
    expect(res.json().key).toMatch(/^rk_test_/);
  });

  it('lists keys without secrets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: keysUrl(owner.productionEnvId),
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);
    for (const key of res.json()) {
      expect(key).not.toHaveProperty('key');
      expect(key).not.toHaveProperty('keyHash');
    }
  });

  it('validates the request body (422)', async () => {
    const res = await createKey(owner, owner.developmentEnvId, {
      name: '',
      expiresAt: '2001-01-01T00:00:00Z',
    });
    expect(res.statusCode).toBe(422);
    expect(
      res
        .json()
        .errors.map((e: { path: string }) => e.path)
        .sort(),
    ).toEqual(['expiresAt', 'name']);
  });

  it("hides other tenants' environments (404, not 403)", async () => {
    const create = await createKey(stranger, owner.productionEnvId);
    expect(create.statusCode).toBe(404);
    const list = await app.inject({
      method: 'GET',
      url: keysUrl(owner.productionEnvId),
      headers: { cookie: stranger.cookie },
    });
    expect(list.statusCode).toBe(404);
  });

  it('forbids plain members from creating keys (403), but lets them list', async () => {
    await db.insert(members).values({
      id: newId('membership'),
      organizationId: owner.organizationId,
      userId: stranger.userId,
      role: 'member',
    });
    expect((await createKey(stranger, owner.developmentEnvId)).statusCode).toBe(403);
    const list = await app.inject({
      method: 'GET',
      url: keysUrl(owner.developmentEnvId),
      headers: { cookie: stranger.cookie },
    });
    expect(list.statusCode).toBe(200);
  });

  it('blocks cookie-authenticated writes from an untrusted origin (CSRF)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: keysUrl(owner.developmentEnvId),
      headers: { cookie: owner.cookie, origin: 'https://evil.example' },
      payload: { name: 'pwned' },
    });
    expect(res.statusCode).toBe(403);
    const noOrigin = await app.inject({
      method: 'POST',
      url: keysUrl(owner.developmentEnvId),
      headers: { cookie: owner.cookie },
      payload: { name: 'pwned' },
    });
    expect(noOrigin.statusCode).toBe(403);
  });

  it('revokes a key idempotently', async () => {
    const { id } = (await createKey(owner, owner.developmentEnvId)).json();
    const revoke = () =>
      app.inject({
        method: 'DELETE',
        url: `${keysUrl(owner.developmentEnvId)}/${id}`,
        headers: { cookie: owner.cookie, origin: ORIGIN },
      });

    expect((await revoke()).statusCode).toBe(204);
    const [first] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
    expect(first!.revokedAt).toBeInstanceOf(Date);

    expect((await revoke()).statusCode).toBe(204);
    const [second] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
    expect(second!.revokedAt).toEqual(first!.revokedAt); // original timestamp kept
  });

  it('cannot revoke a key through another environment (404)', async () => {
    const { id } = (await createKey(owner, owner.productionEnvId)).json();
    const res = await app.inject({
      method: 'DELETE',
      url: `${keysUrl(owner.developmentEnvId)}/${id}`,
      headers: { cookie: owner.cookie, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(404);
  });
});
