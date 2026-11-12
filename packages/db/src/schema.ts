/**
 * Relay data model.
 *
 * Tenancy: every tenant-owned row carries `organization_id` AND
 * `environment_id`. Environments give each org isolated "development" /
 * "production" worlds (Stripe-style test vs live mode) with separate keys,
 * endpoints and event history. Carrying `organization_id` everywhere — even
 * where it is derivable via a join — enables cheap tenant-scoped queries and
 * Postgres Row-Level Security later (see ADR-002).
 *
 * IDs are prefixed ULIDs generated in the application (see @relay/shared).
 *
 * Identity tables (users, sessions, accounts, verifications, members,
 * invitations) follow the shape Better Auth expects (see ADR-0007): Drizzle
 * property names must match Better Auth field names; SQL columns stay
 * snake_case. Better Auth's `organization` model maps onto our `organizations`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ─── Identity (Better Auth) ─────────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Opaque random token stored in the session cookie. */
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Organization the dashboard is currently scoped to. */
    activeOrganizationId: text('active_organization_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Login methods per user: one row per OAuth provider, plus `credential` for email/password. */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The user's id at the provider (or the user id for `credential`). */
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    /** Password hash (scrypt) for the `credential` provider. */
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('accounts_user_idx').on(t.userId),
    uniqueIndex('accounts_provider_account_uq').on(t.providerId, t.accountId),
  ],
);

/** Short-lived tokens: email verification, password reset, OAuth state. */
export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

// ─── Tenancy ────────────────────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  /** Better Auth stores organization metadata as a JSON string. */
  metadata: text('metadata'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `owner` | `admin` | `member` */
    role: text('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('members_org_user_uq').on(t.organizationId, t.userId),
    index('members_user_idx').on(t.userId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    /** `pending` | `accepted` | `rejected` | `canceled` */
    status: text('status').notNull().default('pending'),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('invitations_org_idx').on(t.organizationId),
    index('invitations_email_idx').on(t.email),
  ],
);

export const environmentKind = pgEnum('environment_kind', ['development', 'production']);

export const environments = pgTable(
  'environments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: environmentKind('kind').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('environments_org_name_uq').on(t.organizationId, t.name)],
);

/**
 * API keys are shown to the user exactly once. We store only a SHA-256 hash
 * (keys are high-entropy, so a slow KDF is unnecessary) plus a short
 * non-secret prefix so the UI can display "rk_live_a1b2…".
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('api_keys_environment_idx').on(t.environmentId)],
);

// ─── Catalog ────────────────────────────────────────────────────────────────

export const eventTypes = pgTable(
  'event_types',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    /** Dotted name, e.g. `invoice.paid`. */
    name: text('name').notNull(),
    description: text('description'),
    /** Optional JSON Schema used to validate payloads and render docs. */
    schema: jsonb('schema'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('event_types_env_name_uq').on(t.environmentId, t.name)],
);

export const endpointStatus = pgEnum('endpoint_status', ['active', 'paused', 'disabled']);

export const endpoints = pgTable(
  'endpoints',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description'),
    status: endpointStatus('status').notNull().default('active'),
    /** Why the system auto-disabled this endpoint (e.g. failing for 5 days). */
    disabledReason: text('disabled_reason'),
    /** `null` = subscribed to all event types. */
    filterEventTypes: text('filter_event_types').array(),
    signingSecret: text('signing_secret').notNull(),
    /** Kept valid for a grace period after rotation; both sign each message. */
    previousSigningSecret: text('previous_signing_secret'),
    secretRotatedAt: timestamp('secret_rotated_at', { withTimezone: true }),
    /** Per-endpoint delivery rate limit; protects slow receivers. `null` = unlimited. */
    rateLimitPerSecond: integer('rate_limit_per_second'),
    /**
     * GCRA state for the rate limit (ADR-0014): the "theoretical arrival time"
     * of the next delivery. One timestamp is the whole token bucket.
     */
    rateLimitTat: timestamp('rate_limit_tat', { withTimezone: true }),
    /** Extra static headers sent with each delivery. */
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
    // ── Health (maintained by the worker on every attempt, ADR-0013) ──
    /** Failed attempts in a row; reset by any success. Drives the circuit breaker. */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** First failure of the current streak; drives auto-disable. `null` when healthy. */
    failingSince: timestamp('failing_since', { withTimezone: true }),
    /** While in the future, scheduled deliveries wait instead of being sent. */
    circuitOpenUntil: timestamp('circuit_open_until', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('endpoints_environment_idx').on(t.environmentId)],
);

// ─── Event pipeline ─────────────────────────────────────────────────────────

/** Immutable record of what the customer sent us. */
export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    /** Client-supplied; a retried POST with the same key returns the original event. */
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('events_env_idempotency_uq').on(t.environmentId, t.idempotencyKey),
    // IDs are time-sortable, so (environment, id) serves "latest events" + cursor pagination.
    index('events_env_id_idx').on(t.environmentId, t.id),
    index('events_env_type_id_idx').on(t.environmentId, t.eventType, t.id),
  ],
);

export const deliveryStatus = pgEnum('delivery_status', [
  'pending', // queued, not yet attempted
  'retrying', // at least one failed attempt, more scheduled
  'succeeded',
  'failed', // retries exhausted → dead letter; can be manually replayed
  'cancelled', // endpoint deleted/disabled before delivery
]);

/** One row per (event × subscribed endpoint) — the unit of delivery. */
export const deliveries = pgTable(
  'deliveries',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    status: deliveryStatus('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastStatusCode: integer('last_status_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Fan-out is idempotent: re-processing an event can never double-create deliveries.
    uniqueIndex('deliveries_event_endpoint_uq').on(t.eventId, t.endpointId),
    index('deliveries_endpoint_id_idx').on(t.endpointId, t.id),
    index('deliveries_env_status_id_idx').on(t.environmentId, t.status, t.id),
  ],
);

export const attemptTrigger = pgEnum('attempt_trigger', ['scheduled', 'manual']);

/** Append-only log of every HTTP attempt — powers the delivery inspector UI. */
export const deliveryAttempts = pgTable(
  'delivery_attempts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    deliveryId: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    trigger: attemptTrigger('trigger').notNull().default('scheduled'),
    /** `null` when no HTTP response was received (timeout, DNS, TLS…). */
    statusCode: integer('status_code'),
    durationMs: integer('duration_ms').notNull(),
    /** Machine-readable failure class: timeout | dns | connection_refused | tls | http_error */
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    requestHeaders: jsonb('request_headers').$type<Record<string, string>>(),
    responseHeaders: jsonb('response_headers').$type<Record<string, string>>(),
    /** Truncated to a few KB to bound storage. */
    responseBody: text('response_body'),
    createdAt: createdAt(),
  },
  (t) => [index('delivery_attempts_delivery_idx').on(t.deliveryId, t.attemptNumber)],
);

/**
 * Hourly delivery analytics per endpoint (ADR-0017), maintained by the
 * worker in each attempt's transaction, so it always agrees with
 * `delivery_attempts`. Every attempt counts as exactly one outcome; latency
 * (attempts that got an HTTP response) is a fixed histogram whose buckets
 * are `LATENCY_BOUNDS_MS` in @relay/shared, so percentiles merge across
 * hours and endpoints. Kept longer than raw history (small rows).
 */
export const deliveryStatsHourly = pgTable(
  'delivery_stats_hourly',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    /** Start of the UTC hour. */
    hour: timestamp('hour', { withTimezone: true }).notNull(),
    /** Attempts that got a 2xx. */
    succeeded: integer('succeeded').notNull().default(0),
    /** Failed attempts that scheduled a retry. */
    retried: integer('retried').notNull().default(0),
    /** Failed attempts with no retry left: the delivery failed. */
    failed: integer('failed').notNull().default(0),
    latencyHistogram: integer('latency_histogram').array().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.endpointId, t.hour] }),
    index('delivery_stats_env_hour_idx').on(t.environmentId, t.hour),
  ],
);

// ─── Notifications ──────────────────────────────────────────────────────────

export const notificationKind = pgEnum('notification_kind', [
  'endpoint_failing', // circuit opened: N failures in a row
  'endpoint_disabled', // auto-disabled after failing for days
  'endpoint_recovered', // first success after the circuit had opened
]);

/**
 * In-app alerts (ADR-0015). Written by the worker in the same transaction
 * as the endpoint health change that caused them, so an alert exists if and
 * only if the change happened. Read state is shared by the organization.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    /** Kept (set null) when the endpoint is deleted: the alert is still history. */
    endpointId: text('endpoint_id').references(() => endpoints.id, { onDelete: 'set null' }),
    /** Snapshot, so the alert still says which URL even after edits or deletion. */
    endpointUrl: text('endpoint_url').notNull(),
    kind: notificationKind('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_env_id_idx').on(t.environmentId, t.id)],
);

// ─── Job queue (Postgres transport, see ADR-004) ────────────────────────────

export const jobStatus = pgEnum('job_status', ['pending', 'active', 'dead']);

/**
 * Generic job table used by the Postgres queue transport.
 * Completed jobs are deleted on ack to keep the table small and avoid bloat;
 * the durable history lives in `deliveries` / `delivery_attempts`.
 */
export const queueJobs = pgTable(
  'queue_jobs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    queue: text('queue').notNull(),
    payload: jsonb('payload').notNull(),
    status: jobStatus('status').notNull().default('pending'),
    priority: integer('priority').notNull().default(0),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(25),
    lockedBy: text('locked_by'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    dedupeKey: text('dedupe_key'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Hot path: "next runnable jobs for queue X". Partial → index stays tiny.
    index('queue_jobs_dequeue_idx')
      .on(t.queue, t.priority.desc(), t.runAt)
      .where(sql`${t.status} = 'pending'`),
    // Reaper: find active jobs whose worker died (lease expired).
    index('queue_jobs_lease_idx')
      .on(t.lockedUntil)
      .where(sql`${t.status} = 'active'`),
    // At most one live job per dedupe key.
    uniqueIndex('queue_jobs_dedupe_uq')
      .on(t.queue, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.status} <> 'dead'`),
  ],
);
