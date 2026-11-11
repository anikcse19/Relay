# Relay

[![CI](https://github.com/anikcse19/Relay/actions/workflows/ci.yml/badge.svg)](https://github.com/anikcse19/Relay/actions/workflows/ci.yml)

**Reliable, multi-tenant webhook & event delivery platform.**
Send one API call — Relay fans it out to every subscriber, signs it, retries
failures with backoff, and shows you exactly what happened to every attempt.

> 🚧 Under active development. Live demo, screenshots and load-test results land here as phases complete.

## Highlights

- **At-least-once delivery** with idempotency enforced by the database at every boundary ([ADR-0003](docs/adr/0003-at-least-once-delivery.md))
- **Transactional fan-out** — event, deliveries and jobs commit atomically; no dual-write problem ([RFC-001](docs/rfc/RFC-001-relay.md))
- **Postgres-first queue** using `FOR UPDATE SKIP LOCKED`, leases and fencing tokens, behind a swappable transport ([ADR-0002](docs/adr/0002-postgres-first.md), [ADR-0004](docs/adr/0004-queue-transport-abstraction.md))
- **Standard Webhooks** signatures with zero-downtime secret rotation
- **Exponential backoff with full jitter**, dead-letter queue and manual replay
- **Multi-tenant** organizations with isolated development/production environments

## Architecture

```
Producer ──POST /v1/events──▶ API ──(1 tx: event + deliveries + jobs)──▶ PostgreSQL
                                                                           │
Dashboard ◀──WebSocket── Realtime gateway ◀── LISTEN/NOTIFY ───────────────┤
                                                                           │ SKIP LOCKED
                                       Customer endpoints ◀── signed HTTPS ── Workers
```

Full design: [RFC-001](docs/rfc/RFC-001-relay.md) · Decisions: [ADRs](docs/adr/README.md) · UX: [UI/UX guidelines](docs/design/ui-ux-guidelines.md)

## Repository layout

```
apps/            deployables (api, worker, realtime, dashboard, docs) — coming in Phase 1+
packages/
  shared/        prefixed ULIDs, webhook signing, retry policy
  db/            Drizzle schema, migrations, PGlite test harness
  queue/         QueueTransport interface, Postgres transport, Consumer
docs/            RFC, ADRs, design guidelines
infra/           docker-compose / k8s / terraform for deployment
```

## Getting started

Requirements: Node ≥ 22, pnpm. **No Docker needed** — tests run against
PGlite (Postgres compiled to WebAssembly) in-process.

```bash
pnpm install
pnpm build
pnpm test        # unit + integration tests against real Postgres semantics
pnpm lint
```

To run against a real database, copy `.env.example` to `.env`, set
`DATABASE_URL` (e.g. a free [Neon](https://neon.tech) project) and run `pnpm db:migrate`.

## Tech stack

TypeScript · Node.js · NestJS · Next.js · PostgreSQL · Drizzle ORM · Turborepo ·
Vitest · Playwright · k6 · OpenTelemetry · Docker · k3s · Terraform

## Roadmap

- [x] **Phase 0** — Design (RFC, ADRs), monorepo, data model, Postgres queue, signing
- [ ] **Phase 1** — Auth, orgs, API keys, ingest API, delivery worker, basic dashboard
- [ ] **Phase 2** — Reliability: circuit breaker, rate limits, SSRF guard, replay
- [ ] **Phase 3** — Real-time live tail, analytics, polished UI
- [ ] **Phase 4** — SDK, CLI, docs site, billing, AI failure explainer
- [ ] **Phase 5** — Deploy, CI/CD, observability, load & chaos tests
- [ ] **Phase 6** — Showcase: demo video, write-up
