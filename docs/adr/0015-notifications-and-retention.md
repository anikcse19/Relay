# ADR-0015: In-app health notifications and data retention

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

With ADR-0013, endpoints can open their circuit, recover, or be disabled
without anyone noticing until they look at the dashboard. Customers need to
be told.

Separately, every event, delivery and attempt (including response bodies of
up to 4 KB) is kept forever. Neon's free tier has 0.5 GB of storage, so
history must expire.

## Decision

### Notifications are written in the same transaction as the health change

A `notifications` table (`ntf_` ids) gets a row from the worker inside the
transaction that records the attempt and updates the endpoint's health. An
alert therefore exists **if and only if** the change committed: no lost
alerts, and none for changes that rolled back.

Three transitions alert, each **once**:

| Kind                 | When                                                            |
| -------------------- | --------------------------------------------------------------- |
| `endpoint_failing`   | the failure that brings the streak to the circuit threshold     |
| `endpoint_disabled`  | the failure that auto-disables the endpoint (body = the reason) |
| `endpoint_recovered` | the first success after a streak that had opened the circuit    |

A success has to know the streak _before_ it was reset, and `RETURNING` only
returns new values. The success UPDATE therefore joins the row locked
`FOR UPDATE` and returns its previous `consecutive_failures` in the same
statement. Without that, a separate read could race with concurrent attempts.

- Alerts keep a snapshot of `endpoint_url`, and their `endpoint_id` becomes
  null on delete, so they remain readable history.
- Read state is per environment, shared by the organization's members. The
  "Mark all read" endpoint is idempotent.
- **Delivery channel: in-app only, by choice.** There's a bell with an
  unread badge, polled every 30 s while the tab is visible. Email (for
  example Resend) can be added later as a consumer of this table without
  touching the worker. The table already behaves as an outbox.

### Retention: an hourly, batched, lock-guarded pass in the worker

`RETENTION_DAYS` (default 30) controls `pruneOnce`, which runs a minute
after start and then hourly. It deletes:

- events older than the window, with their deliveries and attempts
  (FK cascade), **never while one of their deliveries is in flight**;
- read notifications older than the window, and any notification older than
  90 days;
- dead-lettered queue jobs older than the window.

How it runs:

- **Index-friendly cutoff.** Ids are time-sortable ULIDs, so "older than the
  cutoff" is `id < newId('event', cutoff)`: a primary-key range scan rather
  than a full scan on `created_at`. The cutoff comes from the database clock.
- **Batches.** 500 rows per statement, at most 50 batches per run, so no
  statement holds locks for long. A large backlog drains over several runs.
- **One worker at a time.** `pg_try_advisory_xact_lock` per batch:
  concurrent workers take turns instead of competing, and a run that loses
  the lock just stops.

## Consequences

- Customers learn about failing, disabled and recovered endpoints within
  about 30 s while the dashboard is open, and the alerts persist until read.
- Storage stays bounded by traffic over the retention window, not total
  lifetime.
- Events older than the retention window can't be replayed or inspected.
  That limit will be documented, and it is what makes the free tier viable.
- Polling (one small query per tab every 30 s) is temporary: Phase 3's live
  WebSocket will push notifications.

## Alternatives considered

- **Detect transitions in the API by diffing health on read:** misses
  transitions between reads (failing → recovered in under a minute) and
  duplicates under concurrency.
- **A separate notifier process reading health changes:** another moving
  part, and it still needs the transition edge the worker already knows.
- **Postgres partitioning by month with `DROP PARTITION`:** the textbook
  approach for large-scale retention, but a big migration and overkill at
  this scale. Revisit in Phase 5 load testing.
- **Per-user read receipts:** an extra join table. Shared read state is
  enough for small teams.
