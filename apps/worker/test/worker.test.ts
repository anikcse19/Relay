import { deliveries, deliveryAttempts, eq, queueJobs } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { PostgresQueue } from '@relay/queue';
import { QUEUES } from '@relay/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { startWorker } from '../src/worker.js';
import { seedDelivery, startReceiver } from './fixtures.js';

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('worker (end to end through the queue)', () => {
  it('picks up a queued delivery, delivers it and acks the job', async () => {
    const database = await createTestDb();
    const receiver = await startReceiver();
    const { db } = database;

    const s = await seedDelivery(db, receiver.url);
    await new PostgresQueue(database.sql).enqueue(
      QUEUES.delivery,
      { deliveryId: s.deliveryId },
      { dedupeKey: s.deliveryId },
    );

    const worker = startWorker({
      database,
      logger: pino({ level: 'silent' }),
      concurrency: 4,
      timeoutMs: 2_000,
      minPollMs: 10,
    });

    try {
      const delivered = await waitFor(async () => {
        const [row] = await db.select().from(deliveries).where(eq(deliveries.id, s.deliveryId));
        return row?.status === 'succeeded' ? row : undefined;
      });
      expect(delivered.attemptCount).toBe(1);
      expect(receiver.received).toHaveLength(1);

      // Job acked → removed from the queue (history lives in delivery_attempts).
      await waitFor(async () => {
        const jobs = await db.select().from(queueJobs).where(eq(queueJobs.dedupeKey, s.deliveryId));
        return jobs.length === 0 ? true : undefined;
      });
      const attempts = await db
        .select()
        .from(deliveryAttempts)
        .where(eq(deliveryAttempts.deliveryId, s.deliveryId));
      expect(attempts).toHaveLength(1);
    } finally {
      await worker.stop();
      await receiver.close();
      await database.close();
    }
  });
});
