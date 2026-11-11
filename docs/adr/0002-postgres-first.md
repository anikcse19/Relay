# ADR-0002: Postgres-first architecture

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

A webhook platform classically uses a database plus a message broker (Kafka,
RabbitMQ, SQS) and a cache/pub-sub layer (Redis). Constraints for v1:

- Zero infrastructure budget (free tiers only).
- No Docker on the primary development machine.
- A single developer — operational simplicity matters.
- Correctness first: the ingest path must not lose events.

## Decision

Use **PostgreSQL for everything in v1**:

| Concern                  | Postgres feature                                          |
| ------------------------ | --------------------------------------------------------- |
| Storage                  | Tables, JSONB payloads                                    |
| Job queue                | `queue_jobs` + `SELECT … FOR UPDATE SKIP LOCKED`          |
| Pub/sub (live dashboard) | `LISTEN` / `NOTIFY`                                       |
| Rate limiting (v1)       | Token bucket rows with atomic `UPDATE … RETURNING`        |
| Tests                    | PGlite (Postgres in WASM) — real SQL semantics, no Docker |

## Consequences

- ✅ **Transactional fan-out**: event + deliveries + jobs commit atomically. No
  dual-write problem, no outbox relay needed.
- ✅ One system to operate, back up and reason about. Runs on Neon's free tier.
- ✅ Tests exercise real SQL (constraints, partial indexes, `SKIP LOCKED`).
- ⚠️ Throughput ceiling: every dequeue/ack is a write; high churn creates dead
  tuples and vacuum pressure. Mitigations: partial indexes, delete-on-ack,
  batched dequeue.
- ⚠️ `LISTEN/NOTIFY` requires a direct (non-pooled) connection.

**Exit criteria:** when k6 load tests show queue latency or DB CPU becoming the
bottleneck, migrate hot queues to Redis/Redpanda behind `QueueTransport`
(ADR-0004). The measurements will be recorded in a follow-up ADR.

## Alternatives considered

- **Kafka/Redpanda from day one** — not free to host, introduces dual writes
  (needs transactional outbox), and is unjustified at current scale.
- **Redis + BullMQ** — good fit for Node, but adds a second stateful system and
  free hosted Redis has tight command quotas that polling workers burn through.
