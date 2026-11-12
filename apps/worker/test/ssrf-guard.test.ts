import type { LookupAddress } from 'node:dns';
import { type Database, deliveryAttempts, eq } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processDelivery } from '../src/delivery-handler.js';
import { createSender, guardedLookup, type ResolveAll } from '../src/http-client.js';
import { seedDelivery, startReceiver } from './fixtures.js';

const resolvesTo =
  (...addresses: string[]): ResolveAll =>
  async () =>
    addresses.map((address): LookupAddress => ({
      address,
      family: address.includes(':') ? 6 : 4,
    }));

/** Calls the lookup the way `net.connect` does and returns what it reported. */
function lookup(resolve: ResolveAll, options: { all?: boolean; family?: number } = {}) {
  return new Promise<{ error: NodeJS.ErrnoException | null; result: unknown }>((done) =>
    guardedLookup(resolve)('hooks.example.com', options, (error, address, family) =>
      done({ error, result: options.all ? address : { address, family } }),
    ),
  );
}

describe('guardedLookup (connect-time DNS check)', () => {
  it('passes public answers through', async () => {
    const one = await lookup(resolvesTo('93.184.215.14'));
    expect(one).toEqual({ error: null, result: { address: '93.184.215.14', family: 4 } });

    const all = await lookup(resolvesTo('93.184.215.14', '2606:4700::1'), { all: true });
    expect(all.error).toBeNull();
    expect(all.result).toHaveLength(2);
  });

  it.each([['127.0.0.1'], ['10.0.0.7'], ['169.254.169.254'], ['::1'], ['fd12::1']])(
    'refuses a hostname that resolves to %s',
    async (address) => {
      const { error } = await lookup(resolvesTo(address));
      expect(error?.code).toBe('ERR_RELAY_BLOCKED_ADDRESS');
      expect(error?.message).toContain(address);
    },
  );

  it('refuses when ANY answer is private (the socket may try any of them)', async () => {
    const { error } = await lookup(resolvesTo('93.184.215.14', '127.0.0.1'), { all: true });
    expect(error?.code).toBe('ERR_RELAY_BLOCKED_ADDRESS');
  });

  it('honours a requested address family', async () => {
    const v6 = await lookup(resolvesTo('93.184.215.14', '2606:4700::1'), { family: 6 });
    expect(v6.result).toEqual({ address: '2606:4700::1', family: 6 });
  });

  it('passes DNS failures through unchanged', async () => {
    const failing: ResolveAll = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    expect((await lookup(failing)).error?.code).toBe('ENOTFOUND');
  });
});

describe('createSender', () => {
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  beforeAll(async () => {
    receiver = await startReceiver();
  });
  afterAll(async () => {
    await receiver.close();
  });

  const request = (url: string) => ({ url, headers: {}, body: '{}', timeoutMs: 2_000 });
  const port = () => new URL(receiver.url).port;

  it('strict: blocks a private IP literal before connecting', async () => {
    const before = receiver.received.length;
    const result = await createSender({ policy: 'strict' })(request(receiver.url));
    expect(result).toMatchObject({ statusCode: null, errorCode: 'blocked_address' });
    expect(receiver.received.length).toBe(before);
  });

  it('strict: blocks a hostname at connect time through the real HTTP agent', async () => {
    // `localhost` → 127.0.0.1/::1 via the system resolver: exercises undici → net → lookup.
    const before = receiver.received.length;
    const result = await createSender({ policy: 'strict' })(request(`http://localhost:${port()}/`));
    expect(result).toMatchObject({ statusCode: null, errorCode: 'blocked_address' });
    expect(result.errorMessage).toMatch(/localhost resolved to .* not a public address/);
    expect(receiver.received.length).toBe(before);
  });

  it('strict: blocks DNS rebinding (a "public" name that now points inside)', async () => {
    const send = createSender({ policy: 'strict', resolveAll: resolvesTo('127.0.0.1') });
    const result = await send(request(`http://rebind.example.com:${port()}/`));
    expect(result.errorCode).toBe('blocked_address');
  });

  it('permissive: delivers to local receivers (development and tests)', async () => {
    receiver.respondWith((_req, res) => res.writeHead(204).end());
    const result = await createSender({ policy: 'permissive' })(
      request(`http://localhost:${port()}/`),
    );
    expect(result).toMatchObject({ statusCode: 204, errorCode: null });
  });
});

describe('blocked_address in the delivery handler', () => {
  let db: Database;
  beforeAll(async () => {
    db = (await createTestDb()).db;
  });

  it('fails immediately: retrying cannot make a private address public', async () => {
    const s = await seedDelivery(db, 'http://127.0.0.1:9/');
    const outcome = await processDelivery(
      { db, timeoutMs: 2_000, send: createSender({ policy: 'strict' }) },
      s.deliveryId,
    );
    expect(outcome).toBe('failed');
    const [attempt] = await db
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, s.deliveryId));
    expect(attempt).toMatchObject({ errorCode: 'blocked_address', statusCode: null });
  });
});
