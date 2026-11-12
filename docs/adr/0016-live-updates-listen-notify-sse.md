# ADR-0016: Live updates with LISTEN/NOTIFY and Server-Sent Events

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

The dashboard polled: events every 2 s while deliveries were in flight, and
the bell every 30 s. The worker also polled for jobs with an idle backoff of
up to 2 s, so a new event could wait that long for its first attempt. The
RFC promises a live event stream and a first attempt in under a second.

Constraints:

- The browser only talks to the dashboard origin (ADR-0010). Vercel can't
  proxy WebSocket upgrades.
- Postgres is the only infrastructure (ADR-0002): no Redis or message
  broker.

## Decision

### Postgres LISTEN/NOTIFY as the bus, published inside the transaction

`NOTIFY` is **transactional**: delivered only when the transaction commits,
and after the change is visible. Producers publish in the same transaction
as the change, so a listener never sees a change that rolled back, or one
it can't yet read.

| Channel      | Message                                                                                           | Published by                       |
| ------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `relay_live` | `event.created` (with initial counts), `delivery.updated` (`from` → `to`), `notification.created` | ingest, worker attempts, replay    |
| `relay_jobs` | queue name                                                                                        | ingest, replay, resume (enqueuers) |

Payloads are ids plus small facts (NOTIFY's limit is 8 kB). Clients fetch
details over REST.

`DatabaseHandle.listener` gives every app one subscription interface:

- **Production:** one dedicated `pg.Client` per process (pooled connections
  can't hold a LISTEN). It reconnects with backoff (0.5 s → 30 s) and
  re-LISTENs every channel. Because messages sent during a gap are lost,
  subscribers are told via `onReconnect`.
- **Tests:** PGlite's in-process `listen`.

### Server-Sent Events, not WebSockets

`GET /v1/environments/:id/stream` (session) and `GET /v1/stream` (API key)
return `text/event-stream`. SSE is plain HTTP:

- it passes through the dashboard's same-origin proxy and Vercel;
- the browser's `EventSource` reconnects by itself;
- `TenantGuard` authorises it like any other route.

We only need server → client traffic, which is all SSE offers.

The API's `LiveHub` holds one LISTEN per process, opened on the first
subscriber (so the API boots and serves REST when the database is down). It
fans messages out per environment.

- Headers: `no-cache, no-transform` and `X-Accel-Buffering: no` stop
  proxies from buffering the stream.
- `retry: 3000` sets the reconnect delay, and a `: ping` every 20 s keeps
  idle connections open.
- After a LISTEN reconnect, every subscriber receives `resync`.

### Dashboard: update the cache in place, never move what the user is reading

One `LiveProvider` per workspace (keyed by environment) owns the
`EventSource`.

- `delivery.updated` patches event-list counts **in place** (rows never
  reorder) and invalidates any open detail (event panel, inspector).
- `event.created` is **buffered** behind a "↑ N new events" pill
  (guidelines §4.2). An empty list applies it straight away, because
  there's nothing to disturb.
- `notification.created` refreshes the bell.
- After any gap (reconnect, resume, tab shown again) the provider resyncs:
  details refetch, and lists offer "Show latest" rather than jumping.
- Status reads ● Live / ◌ Reconnecting… / ○ Offline (with Retry) /
  Paused. The stream closes while the tab is hidden.
- **Polling remains, as a fallback only:** hooks poll when the status isn't
  `live`.

### Workers wake on NOTIFY

`Consumer.poke()` ends the idle wait at once. A `poked` flag covers a
notification that arrives mid-poll, so it isn't lost. Polling stays as the
safety net, so a lost notification costs latency, never a delivery. After a
LISTEN reconnect the worker pokes itself, since jobs may have arrived during
the gap.

## Consequences

- Dashboards see changes as they commit, and new events start delivery
  right away instead of after the poll backoff.
- **Latency is now dominated by database round trips.** Measured from the
  developer's machine to Neon `ap-southeast-1` (≈ 90 ms per round trip):
  POST → `event.created` on the stream ≈ 0.93 s (≈ 10 round trips), then
  ≈ 0.65 s more to delivered. Co-located with the database (≈ 1–2 ms), the
  same path takes tens of ms.
  - **Deployment requirement: the Oracle VM must be in Singapore,** the
    same region as Neon.
- Each API and worker process holds one extra Postgres connection for
  LISTEN. A LISTEN connection stops Neon from scaling to zero, but the
  worker's polling already does that, so there's no new cost.
- The stream doesn't replay missed messages (no `Last-Event-ID`). Clients
  resync instead. Durable replay would need an event log table; revisit if
  the public API's consumers need it.
- Long-lived HTTP responses: the Vercel proxy may cut streams at its
  timeout. `EventSource` reconnects and the client resyncs, so that's
  acceptable.

## Alternatives considered

- **WebSockets:** bidirectional, which we don't need, and they can't pass
  through Vercel rewrites. They would force cross-origin connections and
  third-party cookies (ADR-0010).
- **Redis pub/sub:** another service to host, against ADR-0002, for no gain
  at this scale.
- **Logical replication / CDC (e.g. wal2json):** sees every change without
  touching producers, but needs replication slots (limited on Neon's free
  tier) and decoding infrastructure.
- **Long polling:** simpler servers, but more requests and higher latency
  than SSE for the same result.
