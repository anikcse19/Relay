# ADR-0014: Per-endpoint rate limits with GCRA

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

Some receivers can't absorb spikes: a batch import fires 10 000 events and a
small customer server falls over, turning a burst into a failure streak (and,
with ADR-0013, an open circuit). Customers need to cap the delivery rate per
endpoint. The schema has had `rate_limit_per_second` since Phase 0, but
nothing enforced it.

The limiter must:

- hold across every worker process;
- survive restarts;
- never drop a delivery;
- not burn queue attempts while waiting.

## Decision

### GCRA, stored as one timestamp per endpoint

We use the **Generic Cell Rate Algorithm** (GCRA). It is a token bucket whose
entire state is one value, the _theoretical arrival time_ (TAT) of the next
delivery, stored in the new nullable column `endpoints.rate_limit_tat`.

```
T = 1 s / rate      τ = T × (rate − 1)              (burst = one second's worth)
allowed ⇔ max(TAT, now) − now ≤ τ       then  TAT ← max(TAT, now) + T
denied  ⇒ wait  max(TAT, now) − τ − now
```

**Check-and-claim is one conditional `UPDATE … WHERE <allowed> RETURNING`.**
Under READ COMMITTED, Postgres re-evaluates the `WHERE` against the latest
row version after acquiring the row lock, so concurrent workers can never
exceed the limit. All time is the database clock. A pure `gcra()` function
mirrors the SQL for tests and documentation.

### Where it sits in the worker

The rate limit is the **last** gate before sending, after
paused/disabled/circuit checks. A delivery held for any other reason never
uses up a slot.

- A denied delivery is deferred with `DeferError` (ADR-0013). That uses no
  queue attempt and no delivery attempt. It also moves `next_attempt_at`,
  which the inspector shows as "Next attempt in …".
- A random 0–1 s spread is added so a backlog doesn't return as one herd.
- Manual replays bypass the limit: they're a single, user-initiated request.
  This matches the circuit breaker.
- Endpoints without a limit cost nothing: no reads or writes beyond the
  existing delivery query.
- Changing the limit resets the bucket (`rate_limit_tat = null`).

### API and dashboard

- `rateLimitPerSecond` (1–1000, `null` = unlimited) on create, update and
  read.
- The endpoint form has an optional "deliveries per second" field.
- The list shows `≤ N/s`.

## Consequences

- Receivers see at most one second's worth of burst, then a steady rate.
  Live check: 10 events to a 2/s endpoint arrived over 5.7 s, none dropped.
- **Known limitation: retry churn with large backlogs.** A denied delivery
  re-polls after its wait. With thousands queued behind a low limit, many
  deferrals happen per slot, which costs worker polls but never correctness.
  The fix, if it's ever needed, is to reserve future slots at enqueue time,
  which needs per-delivery slot state. That's out of scope until load tests
  (Phase 5) show it matters.
- One more nullable column (`0003_endpoint_rate_limit`): instant, no
  backfill.

## Alternatives considered

- **Classic token bucket (tokens + last-refill columns):** same behaviour,
  two columns, and more arithmetic in SQL. GCRA is the same algorithm with a
  single timestamp.
- **Sliding-window count over `delivery_attempts`:** an aggregate query per
  send, and it needs an index on attempts by endpoint and time.
- **In-memory limiter per worker:** the limit would multiply by the number
  of workers and reset on deploy.
- **Rate-limiting at enqueue (spacing `run_at`):** would need to know the
  endpoint's backlog when the event is ingested. That couples ingestion to
  delivery and breaks when limits change.
