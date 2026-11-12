# ADR-0011: Dual-auth tenant routes, endpoint URL safety and cursor pagination

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

Endpoints, events and deliveries must be usable from two clients:

- customers' code, authenticated with an **API key** that is bound to one
  environment;
- the **dashboard**, authenticated with a session cookie, where one user can
  reach many environments.

Endpoints also accept customer-supplied URLs that our worker will later POST
to, which is a server-side request forgery (SSRF) risk. Finally, the event
and delivery logs grow without bound and need a listing strategy that stays
fast.

## Decision

### One controller, two route forms, one `TenantGuard`

Each resource is registered at two paths:

| Path                                        | Credential              | Tenant comes from                  |
| ------------------------------------------- | ----------------------- | ---------------------------------- |
| `/v1/endpoints`                             | `Authorization: Bearer` | the API key's environment          |
| `/v1/environments/:environmentId/endpoints` | session cookie (+ CSRF) | the path, after a membership check |

`TenantGuard` picks the credential **by path, never by what happens to be
present**. There is no fallback from one to the other, so a request is never
authorised by a credential it didn't mean to use. Both forms produce the same
`Tenant` value, so handlers and services exist once.

- Session callers are role-checked per route (`@RequireRoles('owner','admin')`
  on writes). API keys can call every route in their environment, because
  only owners and admins can create them.
- Non-members get 404 (as in ADR-0010), and resources from another
  environment are 404 too: every query is scoped by `environment_id`.

### Endpoint secrets and headers are write-only

The signing secret is returned on create and on rotate, never again.
Rotation keeps the previous secret signing alongside the new one for
`SECRET_ROTATION_GRACE_HOURS` (24 h, shared by the API and the worker).
Custom header values often carry receiver credentials, so responses list
header **names** only. The worker already redacts their values in stored
attempts (ADR-0009). Relay-owned headers (`webhook-*`, `content-type`,
`host`, …) cannot be overridden, and values can't contain CR or LF.

### Endpoint URL policy (basic SSRF guard)

`ENDPOINT_URL_POLICY` is `strict` by default in production and `permissive`
elsewhere.

- **Strict:** https only; no credentials in the URL; no `localhost`,
  single-label or internal-suffix hosts; IP literals and **every** DNS answer
  must be public. A `net.BlockList` covers loopback, RFC 1918, link-local
  (including cloud metadata at 169.254.169.254), CGNAT, multicast, reserved
  and documentation ranges, and NAT64/6to4 prefixes.
- **Permissive:** http or https, and localhost allowed, so local receivers
  work in development.

Failures are returned as a field error on `url` (same shape as schema
validation), so forms can show them inline.

This check runs at registration time only, so it **cannot stop DNS
rebinding**. Phase 2 adds a connect-time check in the worker (the address
actually dialled must be public), and that check is the real boundary.

### Pausing never drops deliveries

The worker acks jobs for paused endpoints and leaves their deliveries
pending. Resuming an endpoint re-queues its `pending`/`retrying` deliveries
in the same transaction as the status change. The queue's dedupe key makes
this idempotent.

### Cursor pagination on time-sortable ids

Lists return `{ data, nextCursor }`, newest first. The cursor is the last
id of the page, and the next page is `id < cursor ORDER BY id DESC LIMIT n+1`
(the extra row only tells us whether there is another page). This uses the
existing `(environment_id, id)`-style indexes, stays fast at any depth, and
never skips or repeats rows when new ones arrive. Event lists include
per-status delivery counts from one grouped query per page. Payloads appear
only on detail views.

The inspector's `requestBody` comes from `webhookBody()` in `@relay/shared`,
the same function the worker uses to send, so it shows the exact bytes that
were signed.

## Consequences

- One code path serves both the public API and the dashboard. OpenAPI lists
  both forms of each route.
- Deleting an endpoint cascades its delivery history. Queued jobs for it
  become no-ops.
- Production endpoint registration does one DNS lookup.
- Strict mode can reject a URL whose DNS is temporarily broken; the user
  sees a clear message and retries.

## Alternatives considered

- **Separate controllers per auth mode:** twice the routes to keep in sync.
- **Accept either credential on every path:** ambiguous, and it widens what a
  leaked cookie or key can reach.
- **An environment header for session calls (`Relay-Environment`):** loses
  stable, cacheable, linkable URLs.
- **Offset pagination:** slows down with depth and shifts rows when new
  events arrive.
- **Soft-deleting endpoints:** keeps history, but needs a migration and
  filters everywhere. Revisit with retention policies in Phase 3.
