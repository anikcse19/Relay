import { and, type Database, endpoints, eq, sql } from '@relay/db';

/**
 * Per-endpoint rate limit with GCRA, the "generic cell rate algorithm"
 * (ADR-0014). It's a token bucket whose whole state is one timestamp, the
 * theoretical arrival time (TAT) of the next delivery:
 *
 *   interval T = 1 s / rate      burst tolerance τ = T × (burst − 1)
 *   allowed  ⇔  max(TAT, now) − now ≤ τ        then  TAT ← max(TAT, now) + T
 *   denied   ⇒  retry after  max(TAT, now) − τ − now
 *
 * The burst is one second's worth (`burst = rate`): an idle endpoint
 * limited to 10/s may receive 10 at once, then 1 every 100 ms.
 * Check-and-claim is a single conditional UPDATE, so concurrent workers can
 * never exceed the limit, and all time comes from the database clock.
 */

/** Pure model of the rule above, for tests and documentation. */
export function gcra(
  rate: number,
  tatMs: number | null,
  nowMs: number,
): { allowed: true; tatMs: number } | { allowed: false; waitMs: number } {
  const interval = 1000 / rate;
  const tolerance = interval * (rate - 1);
  const start = Math.max(tatMs ?? nowMs, nowMs);
  if (start - nowMs <= tolerance) return { allowed: true, tatMs: start + interval };
  return { allowed: false, waitMs: Math.ceil(start - tolerance - nowMs) };
}

/**
 * Claims a send slot for the endpoint. Returns 0 when the delivery may go
 * now, otherwise how many milliseconds to wait before trying again.
 */
export async function acquireSlot(
  db: Database,
  endpointId: string,
  ratePerSecond: number,
): Promise<number> {
  const interval = sql`(1000.0 / ${ratePerSecond}::double precision)`;
  const tolerance = sql`(${interval} * (${ratePerSecond}::double precision - 1))`;
  const start = sql`greatest(coalesce(${endpoints.rateLimitTat}, now()), now())`;
  const startMs = sql`(extract(epoch from (${start} - now())) * 1000)`;

  const claimed = await db
    .update(endpoints)
    .set({ rateLimitTat: sql`${start} + ${interval} * interval '1 millisecond'` })
    .where(and(eq(endpoints.id, endpointId), sql`${startMs} <= ${tolerance}`))
    .returning({ id: endpoints.id });
  if (claimed.length > 0) return 0;

  const [row] = await db
    .select({ waitMs: sql<number>`greatest(1, ceil(${startMs} - ${tolerance}))::int` })
    .from(endpoints)
    .where(eq(endpoints.id, endpointId));
  return row?.waitMs ?? 1;
}
