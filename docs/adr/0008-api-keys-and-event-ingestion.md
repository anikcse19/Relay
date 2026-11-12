# ADR-0008: API keys and transactional event ingestion

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

Producers call `POST /v1/events` from their servers, so they need credentials
scoped to one environment. Ingestion has to meet the RFC-001 durability goal:
once we return `202`, the event will be delivered or dead-lettered, never lost.
Retries of the same request (network timeouts) must not produce duplicate
webhooks (ADR-0003).

## Decision

### API keys

- **Format:** `rk_test_…` (development) / `rk_live_…` (production) followed by 43
  base62 characters (~256 bits from `crypto.randomBytes`, using unbiased
  rejection sampling). The mode prefix makes a key's blast radius obvious. The
  fixed shape lets secret scanners match leaked keys. Base62 means a
  double-click selects the whole key.
- **Storage:** the key is shown once. We store only its SHA-256 hash (unique
  index, which is also the lookup path) and a 14-character display prefix.
  A fast hash is fine for 256-bit random secrets; slow KDFs exist to protect
  low-entropy passwords, and would add latency to every API call.
- **Auth failures** (malformed, unknown, revoked, expired) all return the same
  `401` with `WWW-Authenticate: Bearer`, so callers can't probe key state.
- **`last_used_at`** is updated with a conditional write at most once per
  minute per key, so a busy producer doesn't turn every request into an UPDATE.
- **Management** routes use the session and are scoped by membership. Owners and
  admins can create and revoke keys; any member can list them. An environment
  in another tenant returns `404` rather than `403`, so its existence isn't
  revealed.
- **CSRF for session routes:** `SessionGuard` requires a trusted `Origin`/`Referer`
  on state-changing methods. This adds defence in depth on top of
  `SameSite=Lax` cookies, which don't protect against same-site (sibling
  subdomain) attackers.

### Ingestion

- **Body:** `{ "type": "invoice.paid", "data": { … } }`, matching the Standard
  Webhooks payload shape. Zod validates it, and the same schema generates the
  OpenAPI docs.
- **One transaction** writes the event, one `deliveries` row per active,
  subscribed endpoint in the key's environment, and one `queue_jobs` row per
  delivery (payload `{ deliveryId }`, `dedupe_key = deliveryId`). With the queue
  in Postgres there is no dual write, so no outbox relay is needed. A test
  makes the queue insert fail and checks that nothing survives.
- **Idempotency:** an optional `Idempotency-Key` header (1–255 printable ASCII
  characters), unique per environment. The insert uses `ON CONFLICT DO
NOTHING`, so a concurrent duplicate waits for the first transaction and then
  takes the replay path. A replay returns the original event with
  `Idempotent-Replayed: true`. Reusing a key with a different body (compared
  structurally, so JSON key order doesn't matter) returns `409`.
- **Response:** `202 Accepted`. The work is durably queued, not yet done.
- **Job payloads carry only ids.** The worker reads the current delivery and
  endpoint rows, so it never acts on stale copies.

## Consequences

- Ingest latency is one short transaction: about 3 + N statements for N
  endpoints, batched as multi-row inserts.
- Fan-out happens at ingest time. An environment with very many endpoints
  makes ingest slower. If that becomes real, move fan-out into a job (the
  delivery uniqueness constraint already makes it re-runnable).
- Event types are free-form for now. Endpoint filters match exact type names.
  The event-type catalog and payload schema validation come later.
- Moving queues off Postgres (ADR-0004) would bring the dual-write problem
  back for ingest. That migration must add an outbox (`deliveries` rows in
  `pending` already act as one).

## Alternatives considered

- **Insert the event, then enqueue a single fan-out job:** faster ingest for
  large fan-outs, but adds a hop to time-to-first-attempt. Not needed at our
  scale yet.
- **Using `QueueTransport.enqueue` inside the transaction:** the transport
  owns its own connection, so it can't join the Drizzle transaction. Writing
  `queue_jobs` rows through the transaction is the explicit, Postgres-specific
  form of the transactional outbox.
- **Bcrypt/argon2 for key hashes:** these protect guessable secrets, which API
  keys are not. They would cost ~50–100 ms on every authenticated request.
