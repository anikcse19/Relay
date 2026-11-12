import { deliveries, eq, LIVE_CHANNEL, type LiveMessage, notifyJobs, queueJobs } from '@relay/db';
import { createTestDb } from '@relay/db/testing';
import { QUEUES } from '@relay/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { startWorker } from '../src/worker.js';
import { seedDelivery, startReceiver } from './fixtures.js';

describe('worker live wiring (ADR-0016)', () => {
  it('wakes on NOTIFY and announces the delivery status change', async () => {
    const database = await createTestDb();
    const receiver = await startReceiver();
    const messages: LiveMessage[] = [];
    await database.listener.listen(LIVE_CHANNEL, (p) => messages.push(JSON.parse(p)));

    const worker = startWorker({
      database,
      logger: pino({ level: 'silent' }),
      concurrency: 2,
      timeoutMs: 2_000,
      // Without a wake-up, an idle worker would not poll again for a minute.
      minPollMs: 60_000,
    });
    try {
      await new Promise((r) => setTimeout(r, 300)); // first empty poll; now idle

      const s = await seedDelivery(database.db, receiver.url);
      const enqueuedAt = Date.now();
      await database.db.transaction(async (tx) => {
        await tx.insert(queueJobs).values({
          queue: QUEUES.delivery,
          payload: { deliveryId: s.deliveryId },
          dedupeKey: s.deliveryId,
        });
        await notifyJobs(tx, QUEUES.delivery);
      });

      const deadline = Date.now() + 5_000;
      let status = 'pending';
      while (status !== 'succeeded' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
        const [row] = await database.db
          .select({ status: deliveries.status })
          .from(deliveries)
          .where(eq(deliveries.id, s.deliveryId));
        status = row!.status;
      }
      expect(status).toBe('succeeded');
      expect(Date.now() - enqueuedAt).toBeLessThan(2_000); // well under the 60 s poll

      expect(messages).toContainEqual({
        type: 'delivery.updated',
        environmentId: s.environmentId,
        deliveryId: s.deliveryId,
        eventId: s.eventId,
        from: 'pending',
        to: 'succeeded',
        attemptCount: 1,
      });
    } finally {
      await worker.stop();
      await receiver.close();
      await database.close();
    }
  });
});
