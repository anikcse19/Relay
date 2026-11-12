# Progress Tracker

Roadmap for Relay (~2 hours/day, ~12 weeks). Updated at the end of every work session.

## ▶ Next up

**1. Open a PR for `feat/notifications` (Session 12) and merge it.** Migration
`0004_notifications` is **already applied to Neon `main`** (developer chose main again). Before
merging, in the browser: the bell in the header (unread badge, "All quiet" empty state, an alert
opens the Endpoints page, "Mark all read").

**2. Phase 3 · Session 13: Live tail.** Postgres `LISTEN/NOTIFY` → API WebSocket (session-auth,
environment-scoped) → dashboard Events list updates live: "↑ N new events" pill (never shifts
what the user is reading), ● Live / ◌ Reconnecting… / ○ Offline indicator, pause/resume, auto-pause
when the tab is hidden (guidelines §4.2). The worker/API `NOTIFY` on event ingest + delivery
state changes; the bell and the inspector switch from polling to push. Also brings
time-to-first-attempt under 1 s (worker wakes on NOTIFY instead of polling). ADR-0016.
No migration expected. Check :3001/:3100 before any build (memory: dev stack hot-reload).

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

### Phase 2: Reliability ✅

- [x] **Session 9:** Connect-time SSRF guard (undici agent lookup, `blocked_address`, shared
      blocklist/policy), manual replay (API + worker `trigger: 'manual'` + inspector button),
      Vitest timeouts for integration suites, fixed a 1-in-60 jitter flake (ADR-0012)
- [x] **Session 10:** Endpoint health columns (migration 0002), circuit breaker with
      half-open probe, auto-disable after 5 days failing, `DeferError` (deferrals never
      dead-letter jobs), health on the Endpoints page, re-enable resets health (ADR-0013)
- [x] **Session 11:** Per-endpoint rate limits with GCRA (one `rate_limit_tat` column, atomic
      claim in SQL, deferral without attempts, manual bypass), API + form field + list badge,
      inspector shows "Next attempt" for held deliveries (ADR-0014)
- [x] **Session 12:** In-app notifications written in the health transaction (failing /
      disabled / recovered, once each), notifications API + header bell, hourly retention
      (`RETENTION_DAYS`, batched, advisory-locked, ULID range cutoff) (ADR-0015)

### Phase 3: Real-time & UX

- [ ] Live tail (LISTEN/NOTIFY → WebSocket), analytics charts, UI polish

### Phase 4: Developer platform

- [ ] TypeScript SDK, CLI (`relay listen`), docs site, Stripe test billing, AI failure explainer

### Phase 5: Production-grade

- [ ] Deploy (Oracle VM + Vercel), CI/CD, OpenTelemetry/Grafana, k6 load test, chaos test

### Phase 6: Showcase

- [ ] README with screenshots/diagrams, demo video, LinkedIn write-up

## Session log

| Date       | Session       | Done                                                                                                                                                                                                                                                      |
| ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-11 | Phase 0       | Monorepo, RFC + 5 ADRs, UI/UX guidelines, shared/db/queue packages (31 tests), CI. Pushed to GitHub; CI green.                                                                                                                                            |
| 2026-11-12 | Phase 1 · S1  | Neon connected and migrated. API skeleton (`apps/api`), ADR-0006, CI badge. 45 tests passing. Added CLAUDE.md + tracker.                                                                                                                                  |
| 2026-11-12 | Phase 1 · S2  | Better Auth on `/auth/*`, identity tables + migration (applied to Neon), workspace provisioning, `/v1/me`, ADR-0007. 61 tests passing.                                                                                                                    |
| 2026-11-12 | Phase 1 · S3  | Branch `feat/api-keys`. API key management + auth, `POST /v1/events` (one-transaction fan-out, idempotency, atomicity test), ADR-0008. 88 tests passing.                                                                                                  |
| 2026-11-12 | Phase 1 · S4  | Branch `feat/delivery-worker`. `apps/worker` with retry policy, error classes, redirect/blocked-port handling, ADR-0009. Live E2E on Neon: delivered + signature verified in ~1.5 s. 136 tests passing.                                                   |
| 2026-11-12 | Phase 1 · S5  | Branch `feat/dashboard-shell` (not merged yet). Next.js 16 dashboard foundations; caught build-time rewrite baking → runtime `proxy.ts`; ADR-0010. Live E2E via dashboard → API → Neon. 144 tests passing.                                                |
| 2026-11-12 | Phase 1 · S6  | Branch `feat/dashboard-shell`. API keys page + ⌘K palette + collapsible sidebar; live E2E of key lifecycle through the dashboard proxy. 156 tests passing.                                                                                                |
| 2026-11-12 | Phase 1 · S7  | Branch `feat/endpoints-events` (from `feat/dashboard-shell`). Endpoints/events/deliveries API with dual auth, URL policy, cursor pagination, ADR-0011. Live E2E on Neon incl. 503→retry→200. 224 tests passing.                                           |
| 2026-11-12 | Phase 1 · S8  | Branch `feat/endpoints-events`. Endpoints page, Events list + drawer + delivery inspector, test events, checklist 4/4 verified live through the dashboard. Phase 1 complete. 238 tests passing.                                                           |
| 2026-11-12 | Phase 2 · S9  | Branch `feat/reliability`. Connect-time SSRF guard + replay, ADR-0012. Live replay through the dev stack (400 → fix → replay → 200, 409 on double replay). Fixed CI timeouts + a jitter flake. 259 tests passing.                                         |
| 2026-11-12 | Phase 2 · S10 | Branch `feat/endpoint-health`. Health + circuit breaker + auto-disable, queue deferral fix, ADR-0013. Vitest timeouts for queue/db too. 275 tests passing (3 full runs). Migration pending on a Neon branch.                                              |
| 2026-11-12 | Phase 2 · S11 | Branch `feat/rate-limits`. GCRA rate limits, ADR-0014. Migration 0003 applied to Neon `main`. Live: 10 events at 2/s limit → 5.7 s, none dropped. 284 tests passing (2 full runs).                                                                        |
| 2026-11-12 | Phase 2 · S12 | Branch `feat/notifications`. Notifications + bell + retention, ADR-0015. Migration 0004 applied to Neon `main`. Live: failing alert → half-open probe → recovered alert; retention pass on Neon clean. Phase 2 complete. 296 tests passing (2 full runs). |
