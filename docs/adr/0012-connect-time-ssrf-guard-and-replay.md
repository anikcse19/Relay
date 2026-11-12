# ADR-0012: Connect-time SSRF guard and manual replay

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

ADR-0011 added a registration-time check on endpoint URLs and named its gap:
**DNS rebinding**. A hostname can resolve to a public address when the
endpoint is created, then later to `127.0.0.1`, a private network, or the
cloud metadata service (`169.254.169.254`). The worker would then POST signed
requests into our own infrastructure.

Separately, users need to re-send a delivery after fixing their receiver,
without waiting for (or after exhausting) automatic retries.

## Decision

### Check the address the socket actually uses

The worker sends through an `undici` `Agent` whose `connect.lookup` is
`guardedLookup`.

- The lookup runs at **connect time**, on the exact answers the socket is
  about to dial. A rebinding between registration and delivery (or between
  two retries) is caught.
- **Every** answer must be public, not just the first. With Happy Eyeballs
  the socket may try any of them.
- IP-literal URLs skip DNS entirely, so they're checked before connecting.
- A blocked attempt is recorded with error class `blocked_address`. It is
  **permanent** (not retried): a retry can't make a private address public,
  and repeated probing is exactly what an attacker wants.
- The blocklist (`isPublicAddress`) and `UrlPolicy` live in `@relay/shared`,
  so the API (registration) and the worker (connect time) enforce one
  definition. `ENDPOINT_URL_POLICY` applies to both: `strict` in production,
  `permissive` elsewhere, so local receivers keep working.
- Redirects were already never followed (ADR-0009), so a public endpoint
  can't bounce the request inward.

`undici` is now a direct dependency of the worker. Node's global `fetch` is
built on it but doesn't expose `Agent`, and mixing a userland `Agent` with
the built-in `fetch` isn't supported across versions. Using undici's own
`fetch` + `Agent` pair keeps them matched.

### Manual replay is one attempt, not a new retry schedule

`POST /v1/deliveries/:id/replay` (owner/admin in the dashboard, or an API
key) sets a **finished** delivery (`failed`, `succeeded` or `cancelled`)
back to `pending` and enqueues a job with payload
`{ deliveryId, trigger: 'manual' }`. The worker:

- records the attempt with `trigger = 'manual'`;
- does **not** schedule automatic retries if it fails, so the delivery goes
  straight back to `failed`. Without this, a replay's behaviour would depend
  on how many attempts the delivery had used before: one that succeeded on
  attempt 1 would start a fresh retry sequence, while one that failed after
  8 attempts would get none;
- sends the same `webhook-id`, so idempotent receivers handle it safely.

Replay is refused with 409 when the delivery is still scheduled (prevents
double-sends) or the endpoint isn't active (a paused endpoint would hold
it; a disabled one would cancel it). The delivery row is locked during the
check, so concurrent replays can't both enqueue.

`trigger` in the job payload is the job's _intent_, not a copy of row data,
so it doesn't break the "payloads carry ids, the row is the truth" rule
(ADR-0009). No migration was needed: `delivery_attempts.trigger` already
existed.

## Consequences

- Production deliveries can no longer reach internal addresses, even if a
  customer's DNS changes or is malicious.
- One more dependency (`undici`) in the worker, pinned to the major version
  Node 24 bundles.
- Manual attempts count towards `attempt_count`. Attempt numbers keep
  increasing, so the inspector timeline stays in order.
- A replayed delivery that fails stays `failed` until replayed again; there
  is no automatic follow-up.

## Alternatives considered

- **Resolve once in the worker, then connect to the IP:** breaks TLS SNI and
  certificate validation (the certificate is for the hostname), and still
  races with the resolver the socket uses.
- **An egress proxy (e.g. Smokescreen):** the strongest option at scale, but
  another service to run on a free VM. The agent-level guard gives the same
  guarantee for a single worker. Revisit when there are many workers.
- **Replay as a normal attempt (with retries):** see the reasoning above.
- **Replay as a new delivery row:** loses the single timeline per
  (event × endpoint) and breaks the `(event_id, endpoint_id)` uniqueness
  that makes fan-out idempotent.
