import { type Database, deliveries, deliveryAttempts, endpoints, eq, sql } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { RetryLaterError } from '@relay/queue';
import {
  type BackoffPolicy,
  generateSigningSecret,
  type SignatureHeaders,
  verify,
} from '@relay/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decide, type DeliveryDeps, processDelivery, USER_AGENT } from '../src/delivery-handler.js';
import type { SendResult } from '../src/http-client.js';
import { closedPort, type ReceivedRequest, seedDelivery, startReceiver } from './fixtures.js';

const POLICY: BackoffPolicy = { baseMs: 60_000, capMs: 3_600_000, maxAttempts: 3 };

describe('processDelivery', () => {
  let db: Database;
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  let deps: DeliveryDeps;

  beforeAll(async () => {
    db = (await createTestDb()).db;
    receiver = await startReceiver();
    deps = { db, timeoutMs: 2_000, backoff: POLICY };
  });
  afterAll(async () => {
    await receiver.close();
  });
  beforeEach(() => {
    receiver.received.length = 0;
    receiver.respondWith((_req, res) => res.writeHead(200).end('ok'));
  });

  const deliveryRow = async (id: string) =>
    (await db.select().from(deliveries).where(eq(deliveries.id, id)))[0]!;
  const attemptsOf = (id: string) =>
    db.select().from(deliveryAttempts).where(eq(deliveryAttempts.deliveryId, id));
  /** Pretend the scheduled retry time has arrived. */
  const makeDue = (id: string) =>
    db
      .update(deliveries)
      .set({ nextAttemptAt: sql`now()` })
      .where(eq(deliveries.id, id));
  const sigHeaders = (r: ReceivedRequest) => r.headers as unknown as SignatureHeaders;

  it('delivers a signed Standard Webhooks request and records the attempt', async () => {
    const s = await seedDelivery(db, `${receiver.url}/hooks`, {
      headers: { 'x-receiver-token': 'super-secret' },
    });

    expect(await processDelivery(deps, s.deliveryId)).toBe('succeeded');

    const [req] = receiver.received;
    expect(req!.headers['webhook-id']).toBe(s.eventId);
    expect(req!.headers['user-agent']).toBe(USER_AGENT);
    expect(req!.headers['content-type']).toBe('application/json');
    expect(req!.headers['x-receiver-token']).toBe('super-secret'); // custom header sent...
    expect(() => verify(s.secret, sigHeaders(req!), req!.body)).not.toThrow();
    expect(JSON.parse(req!.body)).toMatchObject({
      type: 'invoice.paid',
      data: { invoiceId: 'inv_1', amount: 4200 },
    });

    expect(await deliveryRow(s.deliveryId)).toMatchObject({
      status: 'succeeded',
      attemptCount: 1,
      lastStatusCode: 200,
      nextAttemptAt: null,
    });
    const [attempt] = await attemptsOf(s.deliveryId);
    expect(attempt).toMatchObject({
      attemptNumber: 1,
      statusCode: 200,
      errorCode: null,
      responseBody: 'ok',
      trigger: 'scheduled',
    });
    expect(attempt!.id).toMatch(/^att_/);
    expect(attempt!.requestHeaders!['x-receiver-token']).toBe('[redacted]'); // ...but never stored
    expect(attempt!.requestHeaders!['webhook-signature']).toMatch(/^v1,/);
  });

  it('schedules a retry on 5xx, then succeeds once due', async () => {
    const s = await seedDelivery(db, receiver.url);
    receiver.respondWith((_req, res) => res.writeHead(503).end('maintenance'));

    const error = await processDelivery(deps, s.deliveryId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryLaterError);
    expect((error as RetryLaterError).delayMs).toBeLessThanOrEqual(POLICY.baseMs);

    const afterFail = await deliveryRow(s.deliveryId);
    expect(afterFail).toMatchObject({ status: 'retrying', attemptCount: 1, lastStatusCode: 503 });
    expect(afterFail.nextAttemptAt).toBeInstanceOf(Date);

    receiver.respondWith((_req, res) => res.writeHead(204).end());
    await makeDue(s.deliveryId);
    expect(await processDelivery(deps, s.deliveryId)).toBe('succeeded');

    const attempts = await attemptsOf(s.deliveryId);
    expect(attempts.map((a) => [a.attemptNumber, a.statusCode, a.errorCode])).toEqual([
      [1, 503, 'http_error'],
      [2, 204, null],
    ]);
    // Same message id and byte-identical body on every attempt.
    const [first, second] = receiver.received;
    expect(second!.headers['webhook-id']).toBe(first!.headers['webhook-id']);
    expect(second!.body).toBe(first!.body);
  });

  it('reschedules a job that arrives before the delivery is due, without attempting', async () => {
    const s = await seedDelivery(db, receiver.url);
    receiver.respondWith((_req, res) => res.writeHead(500).end());
    await processDelivery(deps, s.deliveryId).catch(() => {}); // attempt 1 → retrying

    const early = await processDelivery(deps, s.deliveryId).catch((e: unknown) => e);
    expect(early).toBeInstanceOf(RetryLaterError);
    expect((early as RetryLaterError).message).toBe('Delivery is not due yet');
    expect(receiver.received).toHaveLength(1);
    expect(await attemptsOf(s.deliveryId)).toHaveLength(1);
  });

  it('dead-letters after the last allowed attempt', async () => {
    const s = await seedDelivery(db, receiver.url);
    receiver.respondWith((_req, res) => res.writeHead(500).end());

    for (let i = 1; i < POLICY.maxAttempts; i++) {
      await expect(processDelivery(deps, s.deliveryId)).rejects.toBeInstanceOf(RetryLaterError);
      await makeDue(s.deliveryId);
    }
    expect(await processDelivery(deps, s.deliveryId)).toBe('failed');
    expect(await deliveryRow(s.deliveryId)).toMatchObject({
      status: 'failed',
      attemptCount: POLICY.maxAttempts,
      nextAttemptAt: null,
    });
  });

  it('fails immediately on a non-retryable 4xx', async () => {
    const s = await seedDelivery(db, receiver.url);
    receiver.respondWith((_req, res) => res.writeHead(410).end('gone'));
    expect(await processDelivery(deps, s.deliveryId)).toBe('failed');
    expect((await attemptsOf(s.deliveryId))[0]).toMatchObject({
      statusCode: 410,
      responseBody: 'gone',
    });
  });

  it("honours a 429's Retry-After", async () => {
    const s = await seedDelivery(db, receiver.url);
    receiver.respondWith((_req, res) => res.writeHead(429, { 'retry-after': '120' }).end());
    const error = await processDelivery(deps, s.deliveryId).catch((e: unknown) => e);
    expect((error as RetryLaterError).delayMs).toBe(120_000);
  });

  it('records network failures (no response) as retryable attempts', async () => {
    const s = await seedDelivery(db, `http://127.0.0.1:${await closedPort()}/`);
    await expect(processDelivery(deps, s.deliveryId)).rejects.toBeInstanceOf(RetryLaterError);
    expect((await attemptsOf(s.deliveryId))[0]).toMatchObject({
      statusCode: null,
      errorCode: 'connection_refused',
    });
  });

  it('fails immediately on a port fetch refuses to use (no pointless retries)', async () => {
    const s = await seedDelivery(db, 'http://127.0.0.1:6000/'); // X11 port: on the bad-port list
    expect(await processDelivery(deps, s.deliveryId)).toBe('failed');
    expect((await attemptsOf(s.deliveryId))[0]).toMatchObject({ errorCode: 'blocked_port' });
  });

  it('holds deliveries for paused endpoints and cancels them for disabled ones', async () => {
    const paused = await seedDelivery(db, receiver.url, { status: 'paused' });
    const disabled = await seedDelivery(db, receiver.url, { status: 'disabled' });

    expect(await processDelivery(deps, paused.deliveryId)).toBe('held');
    expect((await deliveryRow(paused.deliveryId)).status).toBe('pending');

    expect(await processDelivery(deps, disabled.deliveryId)).toBe('cancelled');
    expect((await deliveryRow(disabled.deliveryId)).status).toBe('cancelled');

    expect(receiver.received).toHaveLength(0);
  });

  it('skips deliveries that are already final or no longer exist (duplicate jobs)', async () => {
    const s = await seedDelivery(db, receiver.url);
    expect(await processDelivery(deps, s.deliveryId)).toBe('succeeded');
    expect(await processDelivery(deps, s.deliveryId)).toBe('skipped');
    expect(await processDelivery(deps, 'dlv_missing')).toBe('skipped');
    expect(receiver.received).toHaveLength(1);
  });

  it('records nothing when another worker recorded the same attempt first', async () => {
    const s = await seedDelivery(db, receiver.url);
    const racing: DeliveryDeps = {
      ...deps,
      // While "our" request is in flight, a second worker finishes the same attempt.
      send: async (): Promise<SendResult> => {
        await db
          .update(deliveries)
          .set({ attemptCount: 1, status: 'succeeded' })
          .where(eq(deliveries.id, s.deliveryId));
        return {
          statusCode: 200,
          durationMs: 5,
          responseHeaders: {},
          responseBody: 'ok',
          errorCode: null,
          errorMessage: null,
        };
      },
    };
    expect(await processDelivery(racing, s.deliveryId)).toBe('superseded');
    expect(await attemptsOf(s.deliveryId)).toHaveLength(0);
  });

  describe('secret rotation', () => {
    it('signs with both secrets during the grace period', async () => {
      const previous = generateSigningSecret();
      const s = await seedDelivery(db, receiver.url, {
        previousSigningSecret: previous,
        secretRotatedAt: new Date(),
      });
      await processDelivery(deps, s.deliveryId);

      const req = receiver.received[0]!;
      expect(String(req.headers['webhook-signature']).split(' ')).toHaveLength(2);
      // Receivers on either the new or the old secret can verify.
      expect(() => verify(s.secret, sigHeaders(req), req.body)).not.toThrow();
      expect(() => verify(previous, sigHeaders(req), req.body)).not.toThrow();
    });

    it('drops the old secret after the grace period', async () => {
      const s = await seedDelivery(db, receiver.url, {
        previousSigningSecret: generateSigningSecret(),
        secretRotatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
      await processDelivery(deps, s.deliveryId);
      expect(String(receiver.received[0]!.headers['webhook-signature']).split(' ')).toHaveLength(1);
    });
  });

  it('cannot let custom endpoint headers override protocol headers', async () => {
    const s = await seedDelivery(db, receiver.url);
    await db
      .update(endpoints)
      .set({ headers: { 'webhook-id': 'spoofed', 'content-type': 'text/plain' } })
      .where(eq(endpoints.id, s.endpointId));
    await processDelivery(deps, s.deliveryId);
    expect(receiver.received[0]!.headers).toMatchObject({
      'webhook-id': s.eventId,
      'content-type': 'application/json',
    });
  });
});

describe('decide (retry policy)', () => {
  const result = (statusCode: number | null, headers: Record<string, string> = {}): SendResult => ({
    statusCode,
    durationMs: 1,
    responseHeaders: headers,
    responseBody: null,
    errorCode: statusCode && statusCode < 300 ? null : 'http_error',
    errorMessage: null,
  });

  it.each([
    [200, 'succeeded'],
    [299, 'succeeded'],
    [400, 'failed'],
    [404, 'failed'],
    [408, 'retrying'],
    [429, 'retrying'],
    [500, 'retrying'],
    [301, 'retrying'],
    [null, 'retrying'],
  ])('HTTP %s on attempt 1 → %s', (status, expected) => {
    expect(decide(result(status), 1, POLICY).status).toBe(expected);
  });

  it('fails once attempts are exhausted', () => {
    expect(decide(result(500), POLICY.maxAttempts, POLICY).status).toBe('failed');
  });

  it('caps Retry-After at the policy ceiling', () => {
    const d = decide(result(503, { 'retry-after': '999999' }), 1, POLICY);
    expect(d).toEqual({ status: 'retrying', delayMs: POLICY.capMs });
  });
});
