# Progress Tracker

Roadmap for Relay (~2 hours/day, ~12 weeks). Updated at the end of every work session.

## ▶ Next up

**1. Open a PR for `feat/endpoints-events` (Sessions 7 + 8) and merge it** (no migration → no
Neon branch). Session 6 already reached `main` via PR #4. `main` CI is currently red: the worker
e2e test times out at Vitest's 5 s default on CI; the fix (`{ timeout: 30_000 }`) is in this
branch, so merging turns `main` green. Before merging, click through in a browser: add/edit/
pause/resume/rotate/delete an endpoint (production: type-to-confirm), Events → "Send test
event" → drawer → delivery inspector (timeline, Response/Request tabs, the explanation for a
failing receiver), `?type=` filter chip, "Load older events", Back button closing the drawer.

**2. Phase 2 · Session 9: Connect-time SSRF guard + manual replay** (branch `feat/reliability`;
no migration expected: `delivery_attempts.trigger` already has `manual`).

- Worker: resolve the hostname, refuse non-public addresses **at connect time** (pinned
  lookup on the undici dispatcher), new error class `blocked_address` (permanent). Reuse
  `isPublicAddress` by moving it from the API to `@relay/shared`. Closes the DNS-rebinding gap
  noted in ADR-0011.
- API: `POST …/deliveries/:id/replay` (owner/admin): resets a final delivery to pending, enqueues
  it, the next attempt is recorded with `trigger: 'manual'`.
- Dashboard: "Replay" button in the delivery inspector (guidelines §4.3), optimistic status.

Later Phase 2 sessions (circuit breaker, auto-disable, per-endpoint rate limits) likely need
endpoint health columns → migration → pair with a Neon branch (count branches first, max 10).

**Local dev ports:** port 3000 is taken by another app on this machine. Run the API with
`PORT=3100 BETTER_AUTH_URL=http://localhost:3100` (root `.env`) and set
`API_URL=http://localhost:3100` + `NEXT_PUBLIC_API_PUBLIC_URL=http://localhost:3100` in
`apps/dashboard/.env.local`.

## Roadmap

### Phase 0: Design & foundation ✅

- [x] Monorepo (pnpm + Turborepo), TypeScript, ESLint, Prettier
- [x] RFC-001 and ADRs 0001–0005; UI/UX guidelines
- [x] `@relay/shared`: ids, Standard Webhooks signing, backoff
- [x] `@relay/db`: schema, initial migration, PGlite test harness
- [x] `@relay/queue`: Postgres SKIP LOCKED transport + Consumer
- [x] GitHub Actions CI (green), Neon database migrated

### Phase 1: Core MVP ✅

- [x] **Session 1:** API skeleton: NestJS + Fastify, config validation, health probes,
      RFC 9457 errors, request IDs, pino logging, OpenAPI + Scalar docs (ADR-0006)
- [x] **Session 2:** Auth (Better Auth: email/password + GitHub), org + environments
      provisioned on sign-up, `SessionGuard`, `GET /v1/me`, CSRF tests (ADR-0007)
- [x] **Session 3:** API keys (`rk_test_`/`rk_live_`, hashed, show-once), `ApiKeyGuard`,
      `POST /v1/events` with transactional fan-out + idempotency, session CSRF guard (ADR-0008)
- [x] **Session 4:** Delivery worker (`apps/worker`): signed delivery, attempt log, retries with
      backoff + Retry-After, race-safe CAS, secret-rotation dual signing (ADR-0009)
- [x] **Session 5:** Dashboard foundations (`apps/dashboard`): tokens + dark/light themes, UI
      primitives, sign-in/up, app shell (org/env switchers, dev banner), Overview, runtime
      same-origin proxy (ADR-0010)
- [x] **Session 6:** Dashboard: API keys page (show-once secret + curl, optimistic revoke,
      type-to-confirm in production), StatusBadge, RelativeTime, TanStack Query, ⌘K palette,
      collapsible sidebar, data-driven checklist
- [x] **Session 7:** API: endpoints CRUD + secret rotation + pause/resume (re-queues held
      deliveries), basic SSRF URL policy, `TenantGuard` (API key **or** session on every route),
      cursor-paginated events/deliveries, delivery detail with attempts (ADR-0011)
- [x] **Session 8:** Dashboard: Endpoints page (create/edit, show-once secret + verify snippet,
      pause/resume, rotate, delete with type-to-confirm), Events list (URL filters, load more,
      send test event), drawer with event detail + delivery inspector (timeline with deltas,
      request/response tabs, plain-English failures), checklist 2–4 data-driven

### Phase 2: Reliability

- [ ] Circuit breaker, per-endpoint rate limits, SSRF guard, manual replay, auto-disable

### Phase 3: Real-time & UX

- [ ] Live tail (LISTEN/NOTIFY → WebSocket), analytics charts, UI polish

### Phase 4: Developer platform

- [ ] TypeScript SDK, CLI (`relay listen`), docs site, Stripe test billing, AI failure explainer

### Phase 5: Production-grade

- [ ] Deploy (Oracle VM + Vercel), CI/CD, OpenTelemetry/Grafana, k6 load test, chaos test

### Phase 6: Showcase

- [ ] README with screenshots/diagrams, demo video, LinkedIn write-up

## Session log

| Date       | Session      | Done                                                                                                                                                                                                            |
| ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-11 | Phase 0      | Monorepo, RFC + 5 ADRs, UI/UX guidelines, shared/db/queue packages (31 tests), CI. Pushed to GitHub; CI green.                                                                                                  |
| 2026-11-12 | Phase 1 · S1 | Neon connected and migrated. API skeleton (`apps/api`), ADR-0006, CI badge. 45 tests passing. Added CLAUDE.md + tracker.                                                                                        |
| 2026-11-12 | Phase 1 · S2 | Better Auth on `/auth/*`, identity tables + migration (applied to Neon), workspace provisioning, `/v1/me`, ADR-0007. 61 tests passing.                                                                          |
| 2026-11-12 | Phase 1 · S3 | Branch `feat/api-keys`. API key management + auth, `POST /v1/events` (one-transaction fan-out, idempotency, atomicity test), ADR-0008. 88 tests passing.                                                        |
| 2026-11-12 | Phase 1 · S4 | Branch `feat/delivery-worker`. `apps/worker` with retry policy, error classes, redirect/blocked-port handling, ADR-0009. Live E2E on Neon: delivered + signature verified in ~1.5 s. 136 tests passing.         |
| 2026-11-12 | Phase 1 · S5 | Branch `feat/dashboard-shell` (not merged yet). Next.js 16 dashboard foundations; caught build-time rewrite baking → runtime `proxy.ts`; ADR-0010. Live E2E via dashboard → API → Neon. 144 tests passing.      |
| 2026-11-12 | Phase 1 · S6 | Branch `feat/dashboard-shell`. API keys page + ⌘K palette + collapsible sidebar; live E2E of key lifecycle through the dashboard proxy. 156 tests passing.                                                      |
| 2026-11-12 | Phase 1 · S7 | Branch `feat/endpoints-events` (from `feat/dashboard-shell`). Endpoints/events/deliveries API with dual auth, URL policy, cursor pagination, ADR-0011. Live E2E on Neon incl. 503→retry→200. 224 tests passing. |
| 2026-11-12 | Phase 1 · S8 | Branch `feat/endpoints-events`. Endpoints page, Events list + drawer + delivery inspector, test events, checklist 4/4 verified live through the dashboard. Phase 1 complete. 238 tests passing.                 |
