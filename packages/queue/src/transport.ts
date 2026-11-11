/**
 * Queue transport abstraction (ADR-004).
 *
 * Application code depends only on this interface. v1 ships a Postgres
 * implementation; a Redis/Redpanda implementation can be swapped in once
 * load tests show Postgres is the bottleneck — without touching callers.
 *
 * Semantics: at-least-once. A job is leased to one worker for `leaseMs`. If the
 * worker crashes, the lease expires and the job becomes visible again, so
 * handlers MUST be idempotent (ADR-003).
 */

export interface Job<T = unknown> {
  id: string;
  queue: string;
  payload: T;
  /** Number of times this job has been dequeued, including the current one. */
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  /**
   * Fencing token for this lease. ack/retry/fail only succeed while the
   * caller still holds the lease, so a worker that stalled past its lease
   * cannot clobber the job after another worker has picked it up.
   */
  leaseToken: string;
}

export interface EnqueueOptions {
  /** Delay before the job becomes runnable. */
  delayMs?: number;
  /** Higher runs first. Default 0. */
  priority?: number;
  /** Attempts before the job is dead-lettered. */
  maxAttempts?: number;
  /** If a live (non-dead) job with this key exists in the queue, enqueue is a no-op. */
  dedupeKey?: string;
}

export interface DequeueOptions {
  limit: number;
  leaseMs: number;
  workerId: string;
}

export type RetryOutcome = 'scheduled' | 'dead' | 'lease_lost';

export interface QueueTransport {
  /** Returns the job id, or `null` if suppressed by `dedupeKey`. */
  enqueue<T>(queue: string, payload: T, options?: EnqueueOptions): Promise<string | null>;
  dequeue<T>(queue: string, options: DequeueOptions): Promise<Job<T>[]>;
  /** Marks the job done. Returns `false` if the lease was lost. */
  ack(job: Job): Promise<boolean>;
  /** Reschedules the job, or dead-letters it if attempts are exhausted. */
  retry(job: Job, options: { delayMs: number; error?: string }): Promise<RetryOutcome>;
  /** Dead-letters the job immediately (non-retryable failure). */
  fail(job: Job, error?: string): Promise<boolean>;
  /** Returns expired leases to the queue. Returns how many jobs were reclaimed. */
  reclaimExpired(): Promise<number>;
}
