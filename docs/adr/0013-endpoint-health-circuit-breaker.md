# ADR-0013: Endpoint health, circuit breaker and auto-disable

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

When a customer's receiver goes down, every queued delivery to it keeps
failing on its own retry schedule. Three problems follow:

- the receiver gets hammered just as it's trying to recover;
- worker slots fill with requests that will time out, which slows every
  other customer's deliveries (noisy neighbour);
- an endpoint that's simply gone (decommissioned, wrong URL) fails forever,
  costing work and filling the logs.

A related latent bug: every job dequeue used up one queue attempt
(dead-letter at 25). A delivery that was only _waiting_ (not due yet, or
blocked by an open circuit) could therefore be dead-lettered without ever
failing, leaving its row `pending` forever.

## Decision

### Health lives on the endpoint and is updated with every attempt

New columns on `endpoints`:

- `consecutive_failures`
- `failing_since`
- `circuit_open_until`
- `last_success_at`

They are updated **in the same transaction** that records the attempt, as
one UPDATE evaluated against the row's current values, so concurrent workers
never lose a count. All times come from the database clock.

- **Success:** the streak and circuit reset. The write is skipped when
  nothing would change (already healthy and `last_success_at` refreshed
  within the last minute), so a busy healthy endpoint isn't one hot row
  rewritten per delivery.
- **Failure:** the streak grows, and `failing_since` keeps the start of the
  streak.

### Circuit breaker

- From `CIRCUIT_FAILURE_THRESHOLD` failures in a row (default 5), the
  circuit opens for 30 s, doubling with each further failure up to 30 min.
- While it's open, scheduled deliveries **wait**: no request is sent, no
  attempt is used, and `next_attempt_at` moves so the inspector shows when
  they'll run. A random 0–5 s spread stops them all returning at once.
- **Half-open:** after the cooldown, exactly one delivery claims the probe
  (an atomic UPDATE pushes `circuit_open_until` forward by one attempt's
  maximum duration). Other workers keep waiting. A successful probe closes
  the circuit; a failed one re-opens it for longer.
- **Manual replays bypass the circuit:** the user is explicitly asking to
  try now.

### Auto-disable

- An active endpoint whose failure streak is older than
  `AUTO_DISABLE_AFTER_HOURS` (default 120 = 5 days) is disabled by the
  failing attempt.
- That attempt also sets `disabled_reason` (shown in the dashboard) and
  cancels the endpoint's queued deliveries in the same transaction.
- Age, not count, decides: a high-volume endpoint can rack up hundreds of
  failures in a short outage that it will recover from.
- Re-enabling (or resuming) an endpoint resets its health. Otherwise an old
  streak would disable it again on the first failure.

### Deferral doesn't use up queue attempts

The queue gets `DeferError` (a `RetryLaterError`). The transport reschedules
the job and refunds the attempt that dequeuing consumed, so a deferred job is
never dead-lettered. The worker uses it for "not due yet" and "circuit open".
Real handler failures still count, so a job that keeps crashing is still
dead-lettered.

## Consequences

- A failing receiver gets at most one request per cooldown instead of a
  burst, and worker capacity goes to healthy endpoints.
- Deliveries held by an open circuit may run up to 30 minutes after the
  receiver recovers. A manual replay sends one straight away, and the probe
  closes the circuit for the rest.
- One extra UPDATE per failed attempt (on the endpoint row). Successful
  attempts usually add none.
- Migration `0002_endpoint_health`: four `ADD COLUMN`s with constant
  defaults, which are instant in Postgres and need no backfill.

## Alternatives considered

- **In-memory circuit per worker:** inconsistent across workers and lost on
  restart. Postgres already serialises updates to the row.
- **Failure-rate window (e.g. 50 % over 10 minutes):** better for flaky
  endpoints, but needs a time-series per endpoint. Consecutive failures is
  simple and is what Stripe- and Svix-style systems expose. Revisit with
  analytics (Phase 3).
- **Disable after N failures:** punishes high-volume endpoints for short
  outages. Disabling by the age of the streak treats every endpoint the same.
