import { randomUUID } from 'node:crypto';
import type {
  DequeueOptions,
  EnqueueOptions,
  Job,
  QueueTransport,
  RetryOutcome,
} from './transport.js';

/** Minimal executor interface satisfied by `pg.Pool`, `pg.Client` and PGlite. */
export interface SqlExecutor {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

interface JobRow {
  id: string;
  queue: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  created_at: Date | string;
  locked_by: string;
}

const DEFAULT_MAX_ATTEMPTS = 25;

/**
 * Postgres-backed queue using `SELECT … FOR UPDATE SKIP LOCKED`.
 *
 * Why this works well at moderate scale:
 *  - SKIP LOCKED lets N workers dequeue concurrently without blocking each
 *    other or double-claiming a row.
 *  - The partial index on pending jobs keeps the hot path small.
 *  - All timestamps come from the database clock (`now()`), so worker clock
 *    skew cannot cause early/late execution.
 *
 * Known limits (documented in ADR-002): every dequeue/ack is a write, so
 * throughput is bounded by Postgres write capacity and vacuum. That is the
 * signal for migrating hot queues to Redis/Redpanda.
 */
export class PostgresQueue implements QueueTransport {
  constructor(private readonly sql: SqlExecutor) {}

  async enqueue<T>(
    queue: string,
    payload: T,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    const { rows } = await this.sql.query<{ id: string }>(
      `INSERT INTO queue_jobs (queue, payload, priority, run_at, max_attempts, dedupe_key)
       VALUES ($1, $2::jsonb, $3, now() + ($4::double precision * interval '1 millisecond'), $5, $6)
       ON CONFLICT (queue, dedupe_key) WHERE dedupe_key IS NOT NULL AND status <> 'dead'
       DO NOTHING
       RETURNING id::text AS id`,
      [
        queue,
        JSON.stringify(payload),
        options.priority ?? 0,
        options.delayMs ?? 0,
        options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        options.dedupeKey ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  }

  async dequeue<T>(queue: string, { limit, leaseMs, workerId }: DequeueOptions): Promise<Job<T>[]> {
    if (limit <= 0) return [];
    const leaseToken = `${workerId}:${randomUUID()}`;
    const { rows } = await this.sql.query<JobRow>(
      `WITH next AS (
         SELECT id FROM queue_jobs
         WHERE queue = $1 AND status = 'pending' AND run_at <= now()
         -- Must match queue_jobs_dequeue_idx exactly (incl. NULLS LAST) so the
         -- planner can read rows in index order and stop after LIMIT.
         ORDER BY priority DESC NULLS LAST, run_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE queue_jobs j
       SET status = 'active',
           attempts = j.attempts + 1,
           locked_by = $3,
           locked_until = now() + ($4::double precision * interval '1 millisecond'),
           updated_at = now()
       FROM next
       WHERE j.id = next.id
       RETURNING j.id::text AS id, j.queue, j.payload, j.attempts, j.max_attempts,
                 j.created_at, j.locked_by`,
      [queue, limit, leaseToken, leaseMs],
    );
    return rows.map((r) => ({
      id: r.id,
      queue: r.queue,
      payload: r.payload as T,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      createdAt: new Date(r.created_at),
      leaseToken: r.locked_by,
    }));
  }

  async ack(job: Job): Promise<boolean> {
    const { rows } = await this.sql.query(
      `DELETE FROM queue_jobs
       WHERE id = $1 AND status = 'active' AND locked_by = $2
       RETURNING id`,
      [job.id, job.leaseToken],
    );
    return rows.length > 0;
  }

  async retry(
    job: Job,
    {
      delayMs,
      error,
      refundAttempt = false,
    }: { delayMs: number; error?: string; refundAttempt?: boolean },
  ): Promise<RetryOutcome> {
    const { rows } = await this.sql.query<{ status: 'pending' | 'dead' }>(
      `UPDATE queue_jobs
       SET status = CASE WHEN NOT $5 AND attempts >= max_attempts THEN 'dead'::job_status
                         ELSE 'pending'::job_status END,
           attempts = CASE WHEN $5 THEN greatest(attempts - 1, 0) ELSE attempts END,
           run_at = now() + ($3::double precision * interval '1 millisecond'),
           locked_by = NULL,
           locked_until = NULL,
           last_error = $4,
           updated_at = now()
       WHERE id = $1 AND status = 'active' AND locked_by = $2
       RETURNING status`,
      [job.id, job.leaseToken, delayMs, error ?? null, refundAttempt],
    );
    const row = rows[0];
    if (!row) return 'lease_lost';
    return row.status === 'dead' ? 'dead' : 'scheduled';
  }

  async fail(job: Job, error?: string): Promise<boolean> {
    const { rows } = await this.sql.query(
      `UPDATE queue_jobs
       SET status = 'dead', locked_by = NULL, locked_until = NULL,
           last_error = $3, updated_at = now()
       WHERE id = $1 AND status = 'active' AND locked_by = $2
       RETURNING id`,
      [job.id, job.leaseToken, error ?? null],
    );
    return rows.length > 0;
  }

  async reclaimExpired(): Promise<number> {
    const { rows } = await this.sql.query(
      `UPDATE queue_jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'dead'::job_status
                         ELSE 'pending'::job_status END,
           locked_by = NULL,
           locked_until = NULL,
           last_error = 'lease expired (worker crashed or stalled)',
           updated_at = now()
       WHERE status = 'active' AND locked_until < now()
       RETURNING id`,
    );
    return rows.length;
  }
}
