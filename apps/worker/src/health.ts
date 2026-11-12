import {
  and,
  type Database,
  deliveries,
  endpoints,
  eq,
  inArray,
  lte,
  notifications,
  publish,
  sql,
} from '@relay/db';
import { newId } from '@relay/shared';

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

/** The facts a notification needs, returned by the health UPDATEs. */
interface EndpointFacts {
  organizationId: string;
  environmentId: string;
  url: string;
}

type Transition = 'endpoint_failing' | 'endpoint_disabled' | 'endpoint_recovered';

/**
 * Writes an in-app alert in the caller's transaction (ADR-0015): the alert
 * exists if and only if the health change that caused it committed.
 */
async function notify(
  tx: Tx,
  endpointId: string,
  facts: EndpointFacts,
  kind: Transition,
  failures: number,
  reason?: string,
) {
  const host = new URL(facts.url).host;
  const text: Record<Transition, { title: string; body: string }> = {
    endpoint_failing: {
      title: `Endpoint failing: ${host}`,
      body:
        `${failures} deliveries in a row failed. Relay is spacing out attempts so your server ` +
        "can recover; deliveries wait, they aren't dropped. Check the delivery inspector for the errors.",
    },
    endpoint_disabled: {
      title: `Endpoint disabled: ${host}`,
      body: reason ?? 'Relay disabled this endpoint after it failed for too long.',
    },
    endpoint_recovered: {
      title: `Endpoint recovered: ${host}`,
      body: `Deliveries are succeeding again after ${failures} failures in a row. Held deliveries are being sent.`,
    },
  };
  const id = newId('notification');
  await tx.insert(notifications).values({
    id,
    organizationId: facts.organizationId,
    environmentId: facts.environmentId,
    endpointId,
    endpointUrl: facts.url,
    kind,
    ...text[kind],
  });
  await publish(tx, {
    type: 'notification.created',
    environmentId: facts.environmentId,
    notificationId: id,
  });
}

/**
 * Success: close the circuit and clear the streak. Skipped when nothing
 * would change (healthy, and `last_success_at` refreshed within the last
 * minute), so a busy healthy endpoint isn't one hot row updated per delivery.
 * If the circuit had opened, this is a recovery: notify.
 */
export async function recordSuccess(
  tx: Tx,
  endpointId: string,
  policy: HealthPolicy,
): Promise<void> {
  // RETURNING only sees new values; joining the locked row gives the streak
  // as it was before this reset, in the same statement.
  const result = await tx.execute(sql`
    update ${endpoints} as e
       set consecutive_failures = 0, failing_since = null,
           circuit_open_until = null, last_success_at = now()
      from (select id, consecutive_failures as previous
              from ${endpoints} where id = ${endpointId} for update) as o
     where e.id = o.id
       and (e.consecutive_failures > 0 or e.circuit_open_until is not null
            or e.last_success_at is null or e.last_success_at < now() - interval '1 minute')
    returning o.previous, e.organization_id, e.environment_id, e.url`);
  const row = (result as unknown as { rows: Record<string, unknown>[] }).rows[0];
  const previous = Number(row?.previous ?? 0);
  if (!row || previous < policy.circuitThreshold) return;
  await notify(
    tx,
    endpointId,
    {
      organizationId: String(row.organization_id),
      environmentId: String(row.environment_id),
      url: String(row.url),
    },
    'endpoint_recovered',
    previous,
  );
}

/**
 * Failure: extend the streak, (re)open the circuit past the threshold, and
 * auto-disable an endpoint whose streak is older than the policy allows.
 * One UPDATE, evaluated against the row's current values, so concurrent
 * failures never lose a count. Notifies when the circuit first opens and
 * when the endpoint is disabled. Returns whether this failure disabled it.
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
  const reason = autoDisableReason(policy);

  const [row] = await tx
    .update(endpoints)
    .set({
      consecutiveFailures: failures,
      failingSince: sql`coalesce(${endpoints.failingSince}, now())`,
      circuitOpenUntil: sql`case when ${failures} >= ${policy.circuitThreshold}
        then now() + ${millis(cooldown)} else ${endpoints.circuitOpenUntil} end`,
      status: sql`case when ${expired} then 'disabled'::endpoint_status else ${endpoints.status} end`,
      disabledReason: sql`case when ${expired} then ${reason}
        else ${endpoints.disabledReason} end`,
    })
    .where(eq(endpoints.id, endpointId))
    .returning({
      status: endpoints.status,
      consecutiveFailures: endpoints.consecutiveFailures,
      organizationId: endpoints.organizationId,
      environmentId: endpoints.environmentId,
      url: endpoints.url,
    });
  if (!row) return { disabled: false };

  // Only active endpoints are attempted, so `disabled` here means "just now".
  if (row.status !== 'disabled') {
    // Exactly at the threshold = the circuit just opened (not on every failure after).
    if (row.consecutiveFailures === policy.circuitThreshold) {
      await notify(tx, endpointId, row, 'endpoint_failing', row.consecutiveFailures);
    }
    return { disabled: false };
  }
  await tx
    .update(deliveries)
    .set({ status: 'cancelled', nextAttemptAt: null })
    .where(
      and(
        eq(deliveries.endpointId, endpointId),
        inArray(deliveries.status, ['pending', 'retrying']),
      ),
    );
  await notify(tx, endpointId, row, 'endpoint_disabled', row.consecutiveFailures, reason);
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
