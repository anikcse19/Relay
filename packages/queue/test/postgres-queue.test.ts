import { createTestDb } from '@relay/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Consumer,
  PermanentFailureError,
  PostgresQueue,
  type ConsumerEvent,
} from '../src/index.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lease = { leaseMs: 30_000, workerId: 'w1' };

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let queue: PostgresQueue;

beforeEach(async () => {
  ctx = await createTestDb();
  queue = new PostgresQueue(ctx.sql);
});

afterEach(async () => {
  await ctx.close();
});

describe('PostgresQueue', () => {
  it('enqueues, dequeues and acks a job', async () => {
    const id = await queue.enqueue('deliveries', { deliveryId: 'dlv_1' });
    expect(id).toBeTruthy();

    const [job] = await queue.dequeue<{ deliveryId: string }>('deliveries', {
      limit: 10,
      ...lease,
    });
    expect(job?.payload.deliveryId).toBe('dlv_1');
    expect(job?.attempts).toBe(1);

    expect(await queue.ack(job!)).toBe(true);
    expect(await queue.dequeue('deliveries', { limit: 10, ...lease })).toHaveLength(0);
  });

  it('never hands the same job to two consumers', async () => {
    for (let i = 0; i < 10; i++) await queue.enqueue('q', { i });
    const a = await queue.dequeue('q', { limit: 6, leaseMs: 30_000, workerId: 'a' });
    const b = await queue.dequeue('q', { limit: 6, leaseMs: 30_000, workerId: 'b' });
    expect(a).toHaveLength(6);
    expect(b).toHaveLength(4);
    const ids = new Set([...a, ...b].map((j) => j.id));
    expect(ids.size).toBe(10);
  });

  it('isolates queues by name', async () => {
    await queue.enqueue('a', {});
    expect(await queue.dequeue('b', { limit: 1, ...lease })).toHaveLength(0);
  });

  it('respects delay', async () => {
    await queue.enqueue('q', {}, { delayMs: 60_000 });
    expect(await queue.dequeue('q', { limit: 1, ...lease })).toHaveLength(0);
  });

  it('runs higher priority jobs first', async () => {
    await queue.enqueue('q', { name: 'low' });
    await queue.enqueue('q', { name: 'high' }, { priority: 10 });
    const [job] = await queue.dequeue<{ name: string }>('q', { limit: 1, ...lease });
    expect(job?.payload.name).toBe('high');
  });

  it('suppresses duplicates with a dedupe key while a job is live', async () => {
    expect(await queue.enqueue('q', {}, { dedupeKey: 'evt_1' })).not.toBeNull();
    expect(await queue.enqueue('q', {}, { dedupeKey: 'evt_1' })).toBeNull();

    const [job] = await queue.dequeue('q', { limit: 1, ...lease });
    await queue.ack(job!);
    // Once completed, the key may be used again.
    expect(await queue.enqueue('q', {}, { dedupeKey: 'evt_1' })).not.toBeNull();
  });

  it('dead-letters a job once attempts are exhausted', async () => {
    await queue.enqueue('q', {}, { maxAttempts: 2 });

    const [first] = await queue.dequeue('q', { limit: 1, ...lease });
    expect(await queue.retry(first!, { delayMs: 0, error: 'boom' })).toBe('scheduled');

    const [second] = await queue.dequeue('q', { limit: 1, ...lease });
    expect(second?.attempts).toBe(2);
    expect(await queue.retry(second!, { delayMs: 0, error: 'boom' })).toBe('dead');

    expect(await queue.dequeue('q', { limit: 1, ...lease })).toHaveLength(0);
  });

  it('never dead-letters a deferred job: deferral refunds the attempt', async () => {
    await queue.enqueue('q', {}, { maxAttempts: 1 });
    for (let i = 0; i < 5; i++) {
      const [job] = await queue.dequeue('q', { limit: 1, ...lease });
      expect(job?.attempts).toBe(1);
      expect(await queue.retry(job!, { delayMs: 0, refundAttempt: true })).toBe('scheduled');
    }
    // A real failure still counts.
    const [job] = await queue.dequeue('q', { limit: 1, ...lease });
    expect(await queue.retry(job!, { delayMs: 0, error: 'boom' })).toBe('dead');
  });

  it('reclaims expired leases and fences out the stale worker', async () => {
    await queue.enqueue('q', { n: 1 });
    const [stale] = await queue.dequeue('q', { limit: 1, leaseMs: 1, workerId: 'slow' });
    await wait(20);

    expect(await queue.reclaimExpired()).toBe(1);
    const [fresh] = await queue.dequeue('q', { limit: 1, leaseMs: 30_000, workerId: 'fast' });
    expect(fresh?.id).toBe(stale?.id);
    expect(fresh?.attempts).toBe(2);

    // The slow worker wakes up and tries to ack — must be rejected.
    expect(await queue.ack(stale!)).toBe(false);
    expect(await queue.ack(fresh!)).toBe(true);
  });
});

describe('Consumer', () => {
  it('processes jobs, retries transient failures and dead-letters permanent ones', async () => {
    const events: ConsumerEvent[] = [];
    const seen = new Map<string, number>();

    for (const kind of ['ok', 'flaky', 'broken', 'ok']) await queue.enqueue('q', { kind });

    const consumer = new Consumer<{ kind: string }>(queue, {
      queue: 'q',
      concurrency: 2,
      minPollMs: 5,
      maxPollMs: 20,
      backoff: { baseMs: 1, capMs: 1, maxAttempts: 5 },
      onEvent: (e) => events.push(e),
      handler: async (job) => {
        seen.set(job.id, (seen.get(job.id) ?? 0) + 1);
        if (job.payload.kind === 'flaky' && job.attempts < 3) throw new Error('503 from endpoint');
        if (job.payload.kind === 'broken') throw new PermanentFailureError('410 Gone');
      },
    });

    consumer.start();
    const deadline = Date.now() + 5_000;
    while (events.filter((e) => e.type === 'completed' || e.type === 'dead_lettered').length < 4) {
      if (Date.now() > deadline) throw new Error('timed out waiting for consumer');
      await wait(10);
    }
    await consumer.stop();

    expect(events.filter((e) => e.type === 'completed')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'dead_lettered')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'retry_scheduled')).toHaveLength(2);
    expect([...seen.values()].sort()).toEqual([1, 1, 1, 3]);
  });
});
