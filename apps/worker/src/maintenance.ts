import { type Database, sql } from '@relay/db';
import { newId } from '@relay/shared';
import type { Logger } from 'pino';

/**
 * Retention (ADR-0015): keeps the database inside Neon's free 0.5 GB by
 * deleting old history. Runs hourly in every worker; a transaction-scoped
 * advisory lock makes concurrent workers take turns instead of competing.
 *
 *  - events older than `retentionDays`, with their deliveries and attempts
 *    (FK cascade), but never while one of their deliveries is in flight;
 *  - read notifications older than `retentionDays`, any older than 90 days;
 *  - dead-lettered queue jobs older than `retentionDays`;
 *  - hourly analytics rollups older than `max(retentionDays, 90)` days
 *    (ADR-0017: small rows, so trends outlive the raw history).
 *
 * Deletes go in small batches so no single statement holds locks for long.
 */
export interface RetentionOptions {
  retentionDays: number;
  batchSize?: number;
  /** Upper bound on batches per run, so one run can't monopolise the database. */
  maxBatches?: number;
}

export interface PruneResult {
  events: number;
  notifications: number;
  deadJobs: number;
  stats: number;
}

/** Analytics rollups are kept at least this long. */
const STATS_MIN_RETENTION_DAYS = 90;

/** Advisory lock key for retention ("rela" in ASCII); any constant unique to this job. */
const MAINTENANCE_LOCK = 0x72656c61;

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

/** One retention pass. Returns `null` if another worker holds the lock. */
export async function pruneOnce(
  db: Database,
  { retentionDays, batchSize = 500, maxBatches = 50 }: RetentionOptions,
): Promise<PruneResult | null> {
  const totals: PruneResult = { events: 0, notifications: 0, deadJobs: 0, stats: 0 };
  const statsDays = Math.max(retentionDays, STATS_MIN_RETENTION_DAYS);

  // Cutoff from the database clock. Ids are time-sortable ULIDs, so "older
  // than the cutoff" is an index range scan on the primary key: `id < cutoffId`.
  const [{ now_ms: nowMs } = { now_ms: 0 }] = rowsOf(
    await db.execute(sql`select (extract(epoch from now()) * 1000)::bigint as now_ms`),
  ) as { now_ms: number | string }[];
  const cutoffMs = Number(nowMs) - retentionDays * 24 * 3_600_000;
  const cutoffEventId = newId('event', cutoffMs);

  for (let batch = 0; batch < maxBatches; batch++) {
    const deleted = await db.transaction(async (tx) => {
      const [lock] = rowsOf(
        await tx.execute(sql`select pg_try_advisory_xact_lock(${MAINTENANCE_LOCK}::bigint) as ok`),
      );
      if (!lock?.ok) return null;

      const events = rowsOf(
        await tx.execute(sql`
          delete from events where id in (
            select e.id from events e
             where e.id < ${cutoffEventId}
               and not exists (select 1 from deliveries d
                                where d.event_id = e.id
                                  and d.status in ('pending', 'retrying'))
             order by e.id
             limit ${batchSize})
          returning id`),
      ).length;
      const notifications = rowsOf(
        await tx.execute(sql`
          delete from notifications where id in (
            select id from notifications
             where (read_at is not null and created_at < now() - make_interval(days => ${retentionDays}))
                or created_at < now() - interval '90 days'
             limit ${batchSize})
          returning id`),
      ).length;
      const deadJobs = rowsOf(
        await tx.execute(sql`
          delete from queue_jobs where id in (
            select id from queue_jobs
             where status = 'dead' and updated_at < now() - make_interval(days => ${retentionDays})
             limit ${batchSize})
          returning id`),
      ).length;
      const stats = rowsOf(
        await tx.execute(sql`
          delete from delivery_stats_hourly where (endpoint_id, hour) in (
            select endpoint_id, hour from delivery_stats_hourly
             where hour < now() - make_interval(days => ${statsDays})
             limit ${batchSize})
          returning hour`),
      ).length;
      return { events, notifications, deadJobs, stats };
    });

    if (deleted === null) return batch === 0 ? null : totals; // another worker took over
    totals.events += deleted.events;
    totals.notifications += deleted.notifications;
    totals.deadJobs += deleted.deadJobs;
    totals.stats += deleted.stats;
    if (Math.max(...Object.values(deleted)) < batchSize) break;
  }
  return totals;
}

/** Runs `pruneOnce` shortly after start, then every `intervalMs`. */
export function startMaintenance(options: {
  db: Database;
  logger: Logger;
  retentionDays: number;
  intervalMs?: number;
}): { stop: () => Promise<void> } {
  const { db, logger, retentionDays, intervalMs = 60 * 60_000 } = options;
  let running: Promise<void> | null = null;

  const run = () => {
    if (running) return; // previous pass still going
    running = pruneOnce(db, { retentionDays })
      .then((result) => {
        if (result && Object.values(result).some((n) => n > 0)) {
          logger.info({ ...result, retentionDays }, 'Retention: pruned old history');
        }
      })
      .catch((error: unknown) => logger.error({ err: error }, 'Retention pass failed'))
      .finally(() => {
        running = null;
      });
  };

  const first = setTimeout(run, 60_000); // let the worker settle after a deploy
  const timer = setInterval(run, intervalMs);
  first.unref();
  timer.unref();

  return {
    stop: async () => {
      clearTimeout(first);
      clearInterval(timer);
      await running;
    },
  };
}
