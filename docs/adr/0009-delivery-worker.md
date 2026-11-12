# ADR-0009: Delivery worker design

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

Ingestion (ADR-0008) commits a `deliveries` row and a queue job for every
subscribed endpoint. Something must now perform the HTTP requests: sign them,
retry failures with backoff, record every attempt for the inspector UI, and
stay correct under the queue's at-least-once semantics (ADR-0003). Jobs can
run twice after a lease expires, and two workers can race on one job.

## Decision

### A separate `apps/worker` process (plain Node, no NestJS)

The worker has no HTTP surface, so a framework would add startup cost and
nothing else. It runs the existing `Consumer` from `@relay/queue` on
`QUEUES.delivery` and scales separately from the API. A slow receiver can't
take API capacity, and an API deploy doesn't interrupt deliveries. `SIGTERM`
stops polling and waits for in-flight attempts. Anything killed mid-attempt
is reclaimed when its lease expires.

### The delivery row owns retry state; the queue job is only a timer

After each attempt, **one transaction** inserts the `delivery_attempts` row and
updates `deliveries` (`status`, `attempt_count`, `next_attempt_at`, last status
code). A retry is reported to the queue by throwing `RetryLaterError(delay)`,
which reschedules the job. This makes the handler safe to repeat:

| Situation                                              | Handling                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Delivery already `succeeded`/`failed`/`cancelled`      | Skip and ack (a duplicate job)                                |
| Job arrives before `next_attempt_at` (reclaimed early) | Reschedule for the remaining time; no attempt                 |
| Two workers attempt the same delivery                  | Compare-and-set on `attempt_count`; the loser records nothing |
| Endpoint `disabled`                                    | Delivery → `cancelled`                                        |
| Endpoint `paused`                                      | Ack and leave `pending`; resuming re-enqueues (Phase 2)       |

All time comparisons use the **database clock** (`now()`), never the worker's.

The job lease is `2 × timeout + 10 s`. That always outlives one attempt, so a
healthy worker's job is never reclaimed mid-request.

### Retry policy (`decide()`, a pure function)

- 2xx → `succeeded`.
- 4xx except 408/429 → `failed` immediately: the receiver rejects the request
  itself, so a retry would only repeat it.
- 5xx, 3xx, 408, 429 and network errors → retry with full-jitter exponential
  backoff (`DEFAULT_BACKOFF`: 8 attempts, about a day). `Retry-After` is
  honoured but capped at the policy ceiling.
- Permanent transport errors (`blocked_port`: fetch refuses the WHATWG "bad
  ports") → `failed` immediately instead of retrying for a day.
- Retries exhausted → `failed`, the dead letter. Manual replay comes in Phase 2.

### Request

- Body: `{"type","timestamp","data"}` (Standard Webhooks), **byte-identical
  across attempts**. `webhook-id` is the event id, so receivers can dedupe.
- Signed **per attempt** (a fresh `webhook-timestamp` for the receiver's
  replay window). During the 24 h after a secret rotation, it's signed with
  both secrets.
- Custom endpoint headers go first, so they can't override `content-type`,
  `user-agent` or the `webhook-*` headers. Their values are **redacted** in the
  stored attempt, because they often carry receiver credentials.
- **Redirects are not followed.** A 3xx counts as a failed attempt. Following
  it would send a signed payload to a URL the customer never registered, and
  is a classic SSRF bypass.
- One timeout (default 15 s) covers connect, headers and body. Only the first
  4 KB of the response body is read and stored; the rest is cancelled.
- Error classes stored in `error_code`: `timeout`, `dns`, `connection_refused`,
  `connection_reset`, `tls`, `blocked_port`, `network`, `http_error`.

## Consequences

- Attempt history is complete and consistent with delivery state (same
  transaction). A crash between the HTTP response and the commit means the
  attempt is repeated. That's at-least-once, as documented.
- Time-to-first-attempt is bounded by idle polling (up to 2 s; about 1.5 s
  measured end-to-end on Neon). The RFC's p50 < 1 s target needs a wake-up
  signal: `NOTIFY` on enqueue, with the consumer `LISTEN`ing (Phase 3).
- **SSRF protection is not in place yet** (Phase 2: resolve and block
  private/link-local/metadata ranges at connect time). Endpoints can't be
  created through the API until then, so there's no exposure today.
- Per-endpoint concurrency and rate limits, circuit breaking and auto-disable
  are Phase 2. Today one failing endpoint consumes retries but cannot block
  others, because each delivery is an independent job.

## Alternatives considered

- **Let the queue own retries (attempt counter on the job):** the delivery row
  would lag behind the real state, and the dashboard needs `next_attempt_at`
  and the status anyway. The queue's own `max_attempts` (25) stays as a
  backstop for handler crashes, such as a database outage.
- **Hold a row lock (`FOR UPDATE`) on the delivery during the HTTP call:**
  holds a transaction open for up to 15 s per delivery, which would exhaust
  the small Neon pool. Optimistic compare-and-set gives the same guarantee.
- **Run the worker inside the API process:** simpler to deploy, but couples
  failure domains and scaling. It's easy to merge later if hosting demands it.
