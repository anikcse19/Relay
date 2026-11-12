import type { DatabaseHandle } from '@relay/db';
import { Consumer, type ConsumerEvent, PostgresQueue } from '@relay/queue';
import { type BackoffPolicy, type DeliveryJobPayload, QUEUES, type UrlPolicy } from '@relay/shared';
import type { Logger } from 'pino';
import { createDeliveryHandler } from './delivery-handler.js';
import type { HealthPolicy } from './health.js';
import { startMaintenance } from './maintenance.js';
import { createSender, type Sender } from './http-client.js';

export interface WorkerOptions {
  database: DatabaseHandle;
  logger: Logger;
  concurrency: number;
  timeoutMs: number;
  backoff?: BackoffPolicy;
  /** Lower bound for idle polling (tests use a small value). */
  minPollMs?: number;
  /** Address policy for outgoing deliveries (default `permissive`). */
  urlPolicy?: UrlPolicy;
  /** Overrides the sender entirely (tests). */
  send?: Sender;
  /** Circuit breaker / auto-disable thresholds (defaults: 5 failures, 5 days). */
  health?: HealthPolicy;
  /** Enables the hourly retention job (off when omitted, e.g. in tests). */
  retentionDays?: number;
}

/**
 * Wires the delivery handler to the Postgres queue. Returned `stop()` stops
 * fetching new jobs and waits for in-flight deliveries (graceful shutdown).
 */
export function startWorker(options: WorkerOptions): { stop: () => Promise<void> } {
  const { database, logger } = options;

  // The job lease must outlive the slowest possible attempt, or the job would
  // be reclaimed and attempted twice while the first attempt is still running.
  const leaseMs = options.timeoutMs * 2 + 10_000;

  const consumer = new Consumer<DeliveryJobPayload>(new PostgresQueue(database.sql), {
    queue: QUEUES.delivery,
    handler: createDeliveryHandler({
      db: database.db,
      timeoutMs: options.timeoutMs,
      send: options.send ?? createSender({ policy: options.urlPolicy ?? 'permissive' }),
      ...(options.backoff && { backoff: options.backoff }),
      ...(options.health && { health: options.health }),
    }),
    concurrency: options.concurrency,
    leaseMs,
    ...(options.minPollMs !== undefined && { minPollMs: options.minPollMs }),
    onEvent: (event) => log(logger, event),
  });

  consumer.start();
  const maintenance =
    options.retentionDays === undefined
      ? null
      : startMaintenance({ db: database.db, logger, retentionDays: options.retentionDays });
  logger.info(
    {
      queue: QUEUES.delivery,
      concurrency: options.concurrency,
      urlPolicy: options.send ? 'custom' : (options.urlPolicy ?? 'permissive'),
    },
    'Worker started',
  );

  return {
    stop: async () => {
      await Promise.all([consumer.stop(), maintenance?.stop()]);
      logger.info('Worker stopped');
    },
  };
}

function log(logger: Logger, event: ConsumerEvent): void {
  const job = 'job' in event ? event.job : undefined;
  const ctx = job
    ? { jobId: job.id, deliveryId: (job.payload as DeliveryJobPayload).deliveryId }
    : {};
  switch (event.type) {
    case 'completed':
      logger.debug({ ...ctx, durationMs: Math.round(event.durationMs) }, 'Job completed');
      break;
    case 'retry_scheduled':
      logger.info(
        { ...ctx, delayMs: event.delayMs, reason: errorMessage(event.error) },
        'Retry scheduled',
      );
      break;
    case 'dead_lettered':
      logger.error({ ...ctx, err: event.error }, 'Job dead-lettered');
      break;
    case 'lease_lost':
      logger.warn(ctx, 'Lease lost (job taken over by another worker)');
      break;
    case 'reclaimed':
      logger.warn({ count: event.count }, 'Reclaimed jobs from crashed or stalled workers');
      break;
    case 'poll_error':
      logger.error({ err: event.error }, 'Queue polling failed');
      break;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
