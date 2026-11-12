import {
  and,
  type Database,
  deliveries,
  endpoints,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from '@relay/db';

/**
 * Endpoint health (ADR-0013). Every attempt updates its endpoint:
 *  - a success resets the failure streak and closes the circuit;
 *  - a failure extends the streak; from `circuitThreshold` failures in a row
 *    the circuit opens and scheduled deliveries wait (cooldown doubles per
 *    further failure, capped) instead of hammering a receiver that's down;
 *  - an endpoint that has failed continuously for `autoDisableAfterMs` is
 *    disabled and its queued deliveries are cancelled.
 */
export interface HealthPolicy {
  circuitThreshold: number;
  circuitBaseMs: number;
  circuitCapMs: number;
  autoDisableAfterMs: number;
}

export const DEFAULT_HEALTH: HealthPolicy = {
  circuitThreshold: 5,
  circuitBaseMs: 30_000,
  circuitCapMs: 30 * 60_000,
  autoDisableAfterMs: 5 * 24 * 60 * 60_000,
};

/** Doubling stops here, so `power(2, n)` can't overflow however long the streak. */
const MAX_DOUBLINGS = 30;

/** Pure version of the SQL below: circuit cooldown after `failures` in a row (`null` = closed). */
export function circuitCooldownMs(failures: number, policy: HealthPolicy): number | null {
  if (failures < policy.circuitThreshold) return null;
  const doublings = Math.min(failures - policy.circuitThreshold, MAX_DOUBLINGS);
  return Math.min(policy.circuitCapMs, policy.circuitBaseMs * 2 ** doublings);
}

export function autoDisableReason(policy: HealthPolicy): string {
  const hours = Math.round(policy.autoDisableAfterMs / 3_600_000);
  const span = hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`;
  return `Disabled automatically: every delivery failed for ${span}. Fix the receiver, then re-enable the endpoint.`;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const millis = (ms: number | ReturnType<typeof sql>) =>
  sql`(${ms}::double precision * interval '1 millisecond')`;

/**
 * Success: close the circuit and clear the streak. Skipped when nothing
 * would change (healthy, and `last_success_at` refreshed within the last
 * minute), so a busy healthy endpoint isn't one hot row updated per delivery.
 */
export async function recordSuccess(tx: Tx, endpointId: string): Promise<void> {
  await tx
    .update(endpoints)
    .set({
      consecutiveFailures: 0,
      failingSince: null,
      circuitOpenUntil: null,
      lastSuccessAt: sql`now()`,
    })
    .where(
      and(
        eq(endpoints.id, endpointId),
        or(
          sql`${endpoints.consecutiveFailures} > 0`,
          sql`${endpoints.circuitOpenUntil} is not null`,
          isNull(endpoints.lastSuccessAt),
          lt(endpoints.lastSuccessAt, sql`now() - interval '1 minute'`),
        ),
      ),
    );
}

/**
 * Failure: extend the streak, (re)open the circuit past the threshold, and
 * auto-disable an endpoint whose streak is older than the policy allows.
 * One UPDATE, evaluated against the row's current values, so concurrent
 * failures never lose a count. Returns whether this failure disabled it.
 */
export async function recordFailure(
  tx: Tx,
  endpointId: string,
  policy: HealthPolicy,
): Promise<{ disabled: boolean }> {
  const failures = sql`(${endpoints.consecutiveFailures} + 1)`;
  const cooldown = sql`least(${policy.circuitCapMs}::double precision,
    ${policy.circuitBaseMs}::double precision
      * power(2, least(${failures} - ${policy.circuitThreshold}, ${MAX_DOUBLINGS})))`;
  const expired = sql`${endpoints.status} = 'active'
    and ${endpoints.failingSince} <= now() - ${millis(policy.autoDisableAfterMs)}`;

  const [row] = await tx
    .update(endpoints)
    .set({
      consecutiveFailures: failures,
      failingSince: sql`coalesce(${endpoints.failingSince}, now())`,
      circuitOpenUntil: sql`case when ${failures} >= ${policy.circuitThreshold}
        then now() + ${millis(cooldown)} else ${endpoints.circuitOpenUntil} end`,
      status: sql`case when ${expired} then 'disabled'::endpoint_status else ${endpoints.status} end`,
      disabledReason: sql`case when ${expired} then ${autoDisableReason(policy)}
        else ${endpoints.disabledReason} end`,
    })
    .where(eq(endpoints.id, endpointId))
    .returning({ status: endpoints.status });

  // Only active endpoints are attempted, so `disabled` here means "just now".
  if (row?.status !== 'disabled') return { disabled: false };
  await tx
    .update(deliveries)
    .set({ status: 'cancelled', nextAttemptAt: null })
    .where(
      and(
        eq(deliveries.endpointId, endpointId),
        inArray(deliveries.status, ['pending', 'retrying']),
      ),
    );
  return { disabled: true };
}

/**
 * Half-open: once the cooldown has passed, exactly one delivery may probe
 * the endpoint. Claiming moves `circuit_open_until` forward by `holdMs`
 * (the longest an attempt can take), so concurrent workers keep waiting
 * until the probe's outcome closes or re-opens the circuit.
 */
export async function claimProbe(db: Database, endpointId: string, holdMs: number) {
  const claimed = await db
    .update(endpoints)
    .set({ circuitOpenUntil: sql`now() + ${millis(holdMs)}` })
    .where(and(eq(endpoints.id, endpointId), lte(endpoints.circuitOpenUntil, sql`now()`)))
    .returning({ id: endpoints.id });
  return claimed.length > 0;
}
