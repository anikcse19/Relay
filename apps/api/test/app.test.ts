import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DatabaseHandle } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot } from './helpers.js';

describe('API (healthy database)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await boot(await createTestDb());
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live → 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready → 200 with database check', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', checks: { database: { status: 'up' } } });
  });

  it('returns RFC 9457 problem details for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      type: 'https://docs.relay.dev/errors/not-found',
      title: 'Not Found',
      status: 404,
      instance: '/nope',
      requestId: res.headers['x-request-id'],
    });
  });

  it('generates a prefixed request id when none is supplied', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['x-request-id']).toMatch(/^req_[0-9A-Z]{26}$/);
  });

  it('propagates a safe incoming x-request-id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'lb-trace-123' },
    });
    expect(res.headers['x-request-id']).toBe('lb-trace-123');
  });

  it('rejects an unsafe incoming x-request-id (log injection)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'evil\nFAKE LOG LINE' },
    });
    expect(res.headers['x-request-id']).toMatch(/^req_/);
  });

  it('serves the OpenAPI document', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.info.title).toBe('Relay API');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/health/live', '/health/ready']),
    );
  });

  it('serves the interactive API reference', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});

describe('API (database down)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await boot({
      db: {} as DatabaseHandle['db'],
      sql: { query: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432')) },
      close: async () => {},
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('readiness fails with 503 without leaking connection details', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'error',
      checks: { database: { status: 'down', error: 'unreachable' } },
    });
    expect(res.body).not.toContain('10.0.0.5');
  });

  it('liveness stays green (no restart loop during a DB outage)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
  });
});
