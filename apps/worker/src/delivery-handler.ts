import {
  and,
  type Database,
  deliveries,
  deliveryAttempts,
  endpoints,
  eq,
  events,
  inArray,
  sql,
} from '@relay/db';
import { DeferError, type Job, RetryLaterError } from '@relay/queue';
import {
  type BackoffPolicy,
  DEFAULT_BACKOFF,
  type DeliveryJobPayload,
  isRetryableStatus,
  newId,
  nextRetryDelay,
  SECRET_ROTATION_GRACE_HOURS,
  sign,
  webhookBody,
} from '@relay/shared';
import {
  PERMANENT_ERROR_CODES,
  parseRetryAfter,
  type SendResult,
  type Sender,
  sendWebhook,
} from './http-client.js';
import {
  claimProbe,
  DEFAULT_HEALTH,
  type HealthPolicy,
  recordFailure,
  recordSuccess,
} from './health.js';

export const USER_AGENT = 'Relay-Webhooks/1.0 (+https://docs.relay.dev/webhooks)';
/** After a secret rotation, deliveries are signed with both secrets for this long. */
const ROTATION_GRACE = sql`make_interval(hours => ${SECRET_ROTATION_GRACE_HOURS})`;
/** Jobs that arrive this close to their scheduled time just run. */
const EARLY_TOLERANCE_MS = 1_000;
const FINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;
/** Spreads deliveries held by an open circuit so they don't all return at once. */
const CIRCUIT_SPREAD_MS = 5_000;

export interface DeliveryDeps {
  db: Database;
  timeoutMs: number;
  backoff?: BackoffPolicy;
  /** How to send; the worker passes a policy-aware sender (`createSender`). */
  send?: Sender;
  /** Circuit breaker and auto-disable thresholds. */
  health?: HealthPolicy;
}

export type DeliveryOutcome =
  | 'succeeded'
  | 'failed' // dead-lettered: non-retryable response or retries exhausted
  | 'cancelled' // endpoint disabled (or auto-disabled by this attempt)
  | 'held' // endpoint paused: stays pending until the endpoint is resumed
  | 'skipped' // already final, or deleted: a duplicate/stale job
  | 'superseded'; // another worker recorded this attempt first

/**
 * Queue handler: attempts one delivery. A retry is reported by throwing
 * `RetryLaterError`, so the queue reschedules the job.
 */
export function createDeliveryHandler(deps: DeliveryDeps) {
  return async (job: Job<DeliveryJobPayload>): Promise<void> => {
    await processDelivery(deps, job.payload.deliveryId, job.payload.trigger ?? 'scheduled');
  };
}

/**
 * The `deliveries` row is the source of truth for retry state; the queue
 * job is only a timer that says "look at this delivery now". That makes the
 * handler safe to run twice for the same job (at-least-once queue):
 *  - final deliveries are skipped;
 *  - a job that arrives before `next_attempt_at` (e.g. reclaimed after a
 *    worker crash) is rescheduled for the remaining time;
 *  - recording an attempt is a compare-and-set on `attempt_count`, so two
 *    workers racing on one delivery can never both record attempt N.
 * All timestamps come from the database clock, not the worker's.
 */
export async function processDelivery(
  deps: DeliveryDeps,
  deliveryId: string,
  trigger: 'scheduled' | 'manual' = 'scheduled',
): Promise<DeliveryOutcome> {
  const { db } = deps;
  const policy = deps.backoff ?? DEFAULT_BACKOFF;
  const send = deps.send ?? sendWebhook;
  const health = deps.health ?? DEFAULT_HEALTH;

  const [row] = await db
    .select({
      organizationId: deliveries.organizationId,
      status: deliveries.status,
      attemptCount: deliveries.attemptCount,
      waitMs: sql<number>`greatest(0, ceil(extract(epoch from (${deliveries.nextAttemptAt} - now())) * 1000))::int`,
      endpointId: deliveries.endpointId,
      endpointStatus: endpoints.status,
      circuitWaitMs: sql<
        number | null
      >`case when ${endpoints.circuitOpenUntil} is null then null else greatest(0, ceil(extract(epoch from (${endpoints.circuitOpenUntil} - now())) * 1000))::int end`,
      url: endpoints.url,
      customHeaders: endpoints.headers,
      secret: endpoints.signingSecret,
      previousSecret: sql<
        string | null
      >`case when ${endpoints.secretRotatedAt} > now() - ${ROTATION_GRACE} then ${endpoints.previousSigningSecret} end`,
      eventId: events.id,
      eventType: events.eventType,
      payload: events.payload,
      eventCreatedAt: events.createdAt,
    })
    .from(deliveries)
    .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
    .innerJoin(events, eq(events.id, deliveries.eventId))
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  if (!row || (FINAL_STATUSES as readonly string[]).includes(row.status)) return 'skipped';

  if (row.waitMs > EARLY_TOLERANCE_MS) {
    throw new DeferError('Delivery is not due yet', row.waitMs);
  }

  if (row.endpointStatus === 'disabled') {
    await db
      .update(deliveries)
      .set({ status: 'cancelled', nextAttemptAt: null })
      .where(
        and(eq(deliveries.id, deliveryId), inArray(deliveries.status, ['pending', 'retrying'])),
      );
    return 'cancelled';
  }
  if (row.endpointStatus === 'paused') return 'held';

  // Circuit breaker: while the endpoint is cooling down, scheduled deliveries
  // wait (without using up attempts). A manual replay is the user explicitly
  // asking to try now, so it goes through.
  if (trigger === 'scheduled' && row.circuitWaitMs !== null) {
    const probeHoldMs = deps.timeoutMs + 5_000;
    const waitMs =
      row.circuitWaitMs > 0
        ? row.circuitWaitMs
        : (await claimProbe(db, row.endpointId, probeHoldMs))
          ? 0 // this delivery is the half-open probe
          : probeHoldMs; // another worker's probe is in flight
    if (waitMs > 0) {
      const delayMs = waitMs + Math.floor(Math.random() * CIRCUIT_SPREAD_MS);
      await db
        .update(deliveries)
        .set({
          nextAttemptAt: sql`now() + (${delayMs}::double precision * interval '1 millisecond')`,
        })
        .where(
          and(eq(deliveries.id, deliveryId), inArray(deliveries.status, ['pending', 'retrying'])),
        );
      throw new DeferError('Endpoint circuit is open; waiting before the next attempt', delayMs);
    }
  }

  // Byte-identical on every attempt (jsonb normalises key order), so receivers
  // can dedupe on `webhook-id` and compare bodies safely.
  const body = webhookBody({
    type: row.eventType,
    createdAt: row.eventCreatedAt,
    data: row.payload,
  });
  const secrets = row.previousSecret ? [row.secret, row.previousSecret] : [row.secret];
  // Signed per attempt: the timestamp must be fresh for the receiver's
  // replay-protection window, while `webhook-id` stays the same.
  const signature = sign(secrets, row.eventId, body);

  const headers: Record<string, string> = {
    ...row.customHeaders, // first, so they can't override the protocol headers below
    'content-type': 'application/json',
    'user-agent': USER_AGENT,
    ...signature,
  };

  const result = await send({ url: row.url, headers, body, timeoutMs: deps.timeoutMs });
  const automatic = decide(result, row.attemptCount + 1, policy);
  // A manual replay is a single attempt: if it fails, the delivery goes back
  // to `failed` rather than starting a new retry schedule.
  const decision: Decision =
    trigger === 'manual' && automatic.status === 'retrying' ? { status: 'failed' } : automatic;

  const recorded = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(deliveries)
      .set({
        status: decision.status,
        attemptCount: row.attemptCount + 1,
        lastAttemptAt: sql`now()`,
        lastStatusCode: result.statusCode,
        nextAttemptAt:
          decision.status === 'retrying'
            ? sql`now() + (${decision.delayMs}::double precision * interval '1 millisecond')`
            : null,
      })
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.attemptCount, row.attemptCount)))
      .returning({ id: deliveries.id });
    if (!updated) return null;

    await tx.insert(deliveryAttempts).values({
      id: newId('attempt'),
      organizationId: row.organizationId,
      deliveryId,
      attemptNumber: row.attemptCount + 1,
      trigger,
      statusCode: result.statusCode,
      durationMs: result.durationMs,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      requestHeaders: redactCustomHeaders(headers, row.customHeaders),
      responseHeaders: result.responseHeaders,
      responseBody: result.responseBody,
    });

    if (decision.status === 'succeeded') {
      await recordSuccess(tx, row.endpointId);
      return { autoDisabled: false };
    }
    const { disabled } = await recordFailure(tx, row.endpointId, health);
    return { autoDisabled: disabled };
  });

  if (!recorded) return 'superseded';
  // This failure disabled the endpoint; its queued deliveries (this one included) were cancelled.
  if (recorded.autoDisabled && decision.status === 'retrying') return 'cancelled';
  if (decision.status === 'retrying') {
    throw new RetryLaterError(
      `Attempt ${row.attemptCount + 1} failed: ${result.errorMessage}`,
      decision.delayMs,
    );
  }
  return decision.status;
}

type Decision = { status: 'succeeded' | 'failed' } | { status: 'retrying'; delayMs: number };

/** Pure retry policy: what to do after attempt number `attemptNumber`. */
export function decide(result: SendResult, attemptNumber: number, policy: BackoffPolicy): Decision {
  if (result.statusCode !== null && result.statusCode >= 200 && result.statusCode < 300) {
    return { status: 'succeeded' };
  }
  // 4xx (except 408/429) means the receiver rejects this request: retrying repeats the failure.
  if (result.statusCode !== null && !isRetryableStatus(result.statusCode)) {
    return { status: 'failed' };
  }
  if (result.errorCode && PERMANENT_ERROR_CODES.has(result.errorCode)) return { status: 'failed' };
  const backoff = nextRetryDelay(attemptNumber, policy);
  if (backoff === null) return { status: 'failed' };

  // Honour the receiver's Retry-After (429/503), but never beyond our cap.
  const retryAfter = parseRetryAfter(result.responseHeaders?.['retry-after']);
  const delayMs = retryAfter === undefined ? backoff : Math.min(retryAfter, policy.capMs);
  return { status: 'retrying', delayMs };
}

/** Endpoint-configured headers may carry receiver credentials: never store their values. */
function redactCustomHeaders(
  headers: Record<string, string>,
  custom: Record<string, string>,
): Record<string, string> {
  const redacted = { ...headers };
  for (const name of Object.keys(custom)) {
    if (redacted[name] === custom[name]) redacted[name] = '[redacted]';
  }
  return redacted;
}
