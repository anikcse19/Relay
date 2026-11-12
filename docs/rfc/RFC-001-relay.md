# RFC-001: Relay — Reliable Webhook & Event Delivery Platform

|             |            |
| ----------- | ---------- |
| **Status**  | Accepted   |
| **Author**  | Anik       |
| **Created** | 2026-11-11 |

## 1. Summary

Relay is a multi-tenant platform that SaaS products use to send webhooks to their
customers. A producer makes one API call (`POST /v1/events`); Relay fans the event
out to every subscribed endpoint, signs it, retries failures with backoff, and
gives both the producer and its customers full visibility into every attempt.

## 2. Problem

Every SaaS that offers webhooks rebuilds the same fragile machinery: retry queues,
signature schemes, endpoint management, debugging UIs. Done poorly, it causes
silent data loss (dropped events), outages (retry storms against a recovering
endpoint), and support load ("did you send the webhook?").

## 3. Goals

1. **No lost events.** Once `POST /v1/events` returns `202`, the event is durably
   stored and will be delivered or explicitly dead-lettered.
2. **Isolation.** One tenant's slow or failing endpoints must not delay others.
3. **Debuggability.** Every attempt (request, response, latency, error class) is
   inspectable and replayable from the dashboard.
4. **Secure by default.** Signed payloads (Standard Webhooks), secret rotation,
   SSRF protection on endpoint URLs.
5. **Cheap to run.** Runs on free-tier infrastructure for the demo.

### Non-goals (v1)

- Exactly-once delivery (impossible over HTTP; we provide at-least-once + idempotency keys).
- Strict per-endpoint ordering (documented; consumers should use timestamps/versions).
- Payload transformation, inbound webhooks, or a customer-facing embeddable portal (future).

## 4. Requirements

| Type                   | Requirement                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional             | Orgs, environments (development/production), API keys, event types, endpoints with filters, event ingestion, fan-out, retries, DLQ, manual replay, live event stream, usage analytics |
| Latency                | p99 ingest API < 100 ms; p50 time-to-first-attempt < 1 s                                                                                                                              |
| Throughput (v1 target) | ≥ 500 events/s sustained on a single small VM, measured with k6                                                                                                                       |
| Durability             | Zero event loss under worker crash (verified by chaos test)                                                                                                                           |
| Retention              | Payloads + attempts retained 30 days (free tier: 7)                                                                                                                                   |

## 5. Architecture

```
            ┌─────────────┐  POST /v1/events
 Producer ─▶│  API (Nest) │──────────────┐
            └──────┬──────┘              │ single transaction:
                   │                     │  INSERT event
                   │                     │  INSERT deliveries (fan-out)
                   ▼                     │  INSERT queue_jobs
            ┌──────────────┐◀────────────┘
            │  PostgreSQL  │  ◀── LISTEN/NOTIFY ── Realtime gateway ──▶ Dashboard (WebSocket)
            └──────┬───────┘
                   │ SELECT … FOR UPDATE SKIP LOCKED
            ┌──────▼───────┐
            │   Workers    │── HTTPS (signed) ──▶ Customer endpoints
            └──────────────┘
```

**Key decision — transactional fan-out.** The event, its delivery rows and the
queue jobs are written in **one Postgres transaction**. This removes the classic
dual-write problem (DB commit succeeds but queue publish fails) without needing
an outbox relay — a direct benefit of using Postgres as the v1 queue (ADR-002).

### 5.1 Delivery lifecycle

```
pending ──attempt──▶ succeeded
   │
   └─fail(retryable)─▶ retrying ──attempt──▶ succeeded
                          │
                          └─attempts exhausted─▶ failed (DLQ) ──manual replay──▶ retrying
   endpoint deleted ─▶ cancelled
```

- Retry schedule: exponential backoff with full jitter, 8 attempts over ~1 day.
- `4xx` (except 408/429) → not retried. `429`/`503` honour `Retry-After`.
- Endpoint failing continuously for N days → auto-disabled + owner notified.

### 5.2 Isolation (noisy neighbour)

v1: per-endpoint concurrency cap + per-endpoint rate limit + circuit breaker
(open after consecutive failures → deliveries are rescheduled instead of
attempted, protecting worker capacity). v2: per-tenant fair queuing.

### 5.3 Security

- API keys: random 32 bytes, stored as SHA-256, shown once, prefix displayed.
- Signatures: Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`), dual-signing during rotation.
- SSRF: resolve endpoint hostnames and block private/link-local/metadata IP ranges at _connect time_ (prevents DNS rebinding).
- Tenant isolation: every query scoped by `organization_id` + `environment_id`; Postgres RLS as defence in depth (Phase 5).

## 6. Data model

See [`packages/db/src/schema.ts`](../../packages/db/src/schema.ts). Core entities:
`organizations → environments → {api_keys, event_types, endpoints, events}`,
`events × endpoints → deliveries → delivery_attempts`, plus `queue_jobs`.

## 7. Evolution plan

| Stage | Trigger                                     | Change                                                          |
| ----- | ------------------------------------------- | --------------------------------------------------------------- |
| v1    | —                                           | Postgres for storage, queue and pub/sub                         |
| v2    | k6 shows queue contention / vacuum pressure | Hot queues → Redis (BullMQ) or Redpanda via `QueueTransport`    |
| v3    | Attempt logs dominate storage               | Attempts → ClickHouse / object storage; time-partition `events` |

## 8. Alternatives considered

- **Kafka from day one** — operationally heavy, not free, and adds a dual-write problem. Deferred until data justifies it.
- **Serverless (Lambda + SQS)** — attractive, but long-running HTTP deliveries and WebSockets fit poorly, and the free-tier story is weaker.

## 9. Open questions

- Ordering guarantees per endpoint: offer opt-in FIFO mode (serialised per endpoint)?
- ~~Identity: map Better Auth's organization/member model onto `organizations` (Phase 1).~~
  Resolved in [ADR-0007](../adr/0007-authentication-better-auth.md).
