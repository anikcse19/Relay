import { type Database, sql } from '@relay/db';
import { type AttemptOutcome, emptyHistogram, latencyBucket } from '@relay/shared';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Start of the current UTC hour on the database clock (independent of the session time zone). */
const CURRENT_HOUR = sql`date_bin('1 hour', now(), timestamptz '1970-01-01 00:00:00+00')`;

/**
 * Counts one attempt in its endpoint's hourly rollup (ADR-0017). Called in
 * the attempt's transaction, which already holds the endpoint row lock
 * (health), so the upsert adds no new contention and the rollup commits
 * if and only if the attempt does.
 */
export async function recordAttemptStats(
  tx: Tx,
  scope: { organizationId: string; environmentId: string; endpointId: string },
  outcome: AttemptOutcome,
  /** `null` when no HTTP response arrived (timeouts aren't latency). */
  durationMs: number | null,
): Promise<void> {
  const histogram = emptyHistogram();
  const bucket = durationMs === null ? null : latencyBucket(durationMs);
  if (bucket !== null) histogram[bucket] = 1;
  const pgIndex = bucket === null ? null : bucket + 1; // Postgres arrays are 1-based

  await tx.execute(sql`
    insert into delivery_stats_hourly as s
      (organization_id, environment_id, endpoint_id, hour, succeeded, retried, failed, latency_histogram)
    values (
      ${scope.organizationId}, ${scope.environmentId}, ${scope.endpointId}, ${CURRENT_HOUR},
      ${outcome === 'succeeded' ? 1 : 0}, ${outcome === 'retried' ? 1 : 0}, ${outcome === 'failed' ? 1 : 0},
      ${`{${histogram.join(',')}}`}::int[]
    )
    on conflict (endpoint_id, hour) do update set
      succeeded = s.succeeded + excluded.succeeded,
      retried = s.retried + excluded.retried,
      failed = s.failed + excluded.failed
      ${pgIndex === null ? sql`` : sql`, latency_histogram[${sql.raw(String(pgIndex))}] = s.latency_histogram[${sql.raw(String(pgIndex))}] + 1`}
  `);
}
