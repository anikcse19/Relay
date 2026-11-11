# ADR-0003: At-least-once delivery with idempotency

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

Exactly-once delivery over HTTP is impossible: if a worker sends a request and
the connection drops before the response arrives, it cannot know whether the
receiver processed it. We must choose between possibly losing a message
(at-most-once) or possibly duplicating it (at-least-once).

## Decision

Relay guarantees **at-least-once** delivery and makes duplicates cheap to handle
at every boundary:

1. **Ingest** — producers may send an `Idempotency-Key` header. A unique index on
   `(environment_id, idempotency_key)` makes retried `POST /v1/events` return the
   original event instead of creating a duplicate.
2. **Fan-out** — unique index on `deliveries(event_id, endpoint_id)` makes fan-out
   re-runnable without creating duplicate deliveries.
3. **Workers** — jobs are leased with a fencing token. A stalled worker that
   loses its lease cannot ack/retry a job now owned by another worker.
4. **Receivers** — every request carries a stable `webhook-id`; we document
   that receivers should dedupe on it.

## Consequences

- ✅ No silent loss: a crash at any point leads to a retry, never a drop.
- ✅ Each layer's idempotency is enforced by the database, not by convention.
- ⚠️ Receivers may see duplicates (rare: only on crash/timeout races). Documented clearly.
- ⚠️ No global ordering guarantee; payloads include timestamps for consumers to reconcile.

## Alternatives considered

- **At-most-once** — unacceptable for billing/payment style events.
- **Distributed transactions / 2PC with receivers** — receivers won't implement it.
