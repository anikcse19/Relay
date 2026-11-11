# ADR-0004: Queue transport abstraction

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

ADR-0002 starts with a Postgres-backed queue but anticipates migrating hot paths
to a dedicated broker. If workers and the API call Postgres queue SQL directly,
that migration becomes a rewrite.

## Decision

Define a small `QueueTransport` interface in `@relay/queue`:

```ts
enqueue(queue, payload, { delayMs, priority, maxAttempts, dedupeKey })
dequeue(queue, { limit, leaseMs, workerId }) → Job[]
ack(job) / retry(job, { delayMs }) / fail(job) / reclaimExpired()
```

Semantics every implementation must provide:

- **Leases** (visibility timeout) — a dequeued job is invisible for `leaseMs`;
  if not acked it is reclaimed.
- **Fencing tokens** — `ack`/`retry`/`fail` succeed only for the current lease holder.
- **Dead-lettering** after `maxAttempts`.
- **Delayed jobs** and **dedupe keys**.

A transport-agnostic `Consumer` provides concurrency control, adaptive polling,
retry classification (`RetryLaterError`, `PermanentFailureError`) and graceful
shutdown. A shared contract test suite will run against every transport.

## Consequences

- ✅ Swapping Postgres → Redis/Redpanda is a configuration change for callers.
- ✅ Business logic (delivery engine) is unit-testable against the interface.
- ⚠️ The interface is the lowest common denominator; broker-specific features
  (e.g. Kafka partitions for ordering) need deliberate extension.
