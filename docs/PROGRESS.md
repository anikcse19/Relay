# Progress Tracker

Roadmap for Relay (~2 hours/day, ~12 weeks). Updated at the end of every work session.

## ▶ Next up

**Phase 1 · Session 6: Dashboard, API keys page + polish** (stay on branch `feat/dashboard-shell`)

- `/[org]/[env]/api-keys`: list (prefix, name, created, last used, status), create dialog with the
  show-once secret flow (Copy + "I've saved this" checkbox, guidelines §6), revoke with confirm.
  Owner/admin only for create/revoke (members see a read-only list + who to ask).
- Enable "API keys" in the sidebar; Overview checklist step 1 becomes data-driven.
- `StatusBadge` (guidelines §2.2) for key status; TanStack Query for client mutations.
- ⌘K command palette (navigate, switch environment, toggle theme); collapsible sidebar.
- Then: open the PR for `feat/dashboard-shell` (Sessions 5 + 6).

**Local dev ports:** port 3000 is taken by another app on this machine. Run the API with
`PORT=3100 BETTER_AUTH_URL=http://localhost:3100` (root `.env`) and set
`API_URL=http://localhost:3100` in `apps/dashboard/.env.local`.

## Roadmap

### Phase 0: Design & foundation ✅

- [x] Monorepo (pnpm + Turborepo), TypeScript, ESLint, Prettier
- [x] RFC-001 and ADRs 0001–0005; UI/UX guidelines
- [x] `@relay/shared`: ids, Standard Webhooks signing, backoff
- [x] `@relay/db`: schema, initial migration, PGlite test harness
- [x] `@relay/queue`: Postgres SKIP LOCKED transport + Consumer
- [x] GitHub Actions CI (green), Neon database migrated

### Phase 1: Core MVP (in progress)

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
- [ ] **Session 6:** Dashboard: API keys page, StatusBadge, ⌘K palette, collapsible sidebar
- [ ] **Sessions 7–8:** Dashboard: endpoints, events list, delivery inspector

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

| Date       | Session      | Done                                                                                                                                                                                                       |
| ---------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-11 | Phase 0      | Monorepo, RFC + 5 ADRs, UI/UX guidelines, shared/db/queue packages (31 tests), CI. Pushed to GitHub; CI green.                                                                                             |
| 2026-11-12 | Phase 1 · S1 | Neon connected and migrated. API skeleton (`apps/api`), ADR-0006, CI badge. 45 tests passing. Added CLAUDE.md + tracker.                                                                                   |
| 2026-11-12 | Phase 1 · S2 | Better Auth on `/auth/*`, identity tables + migration (applied to Neon), workspace provisioning, `/v1/me`, ADR-0007. 61 tests passing.                                                                     |
| 2026-11-12 | Phase 1 · S3 | Branch `feat/api-keys`. API key management + auth, `POST /v1/events` (one-transaction fan-out, idempotency, atomicity test), ADR-0008. 88 tests passing.                                                   |
| 2026-11-12 | Phase 1 · S4 | Branch `feat/delivery-worker`. `apps/worker` with retry policy, error classes, redirect/blocked-port handling, ADR-0009. Live E2E on Neon: delivered + signature verified in ~1.5 s. 136 tests passing.    |
| 2026-11-12 | Phase 1 · S5 | Branch `feat/dashboard-shell` (not merged yet). Next.js 16 dashboard foundations; caught build-time rewrite baking → runtime `proxy.ts`; ADR-0010. Live E2E via dashboard → API → Neon. 144 tests passing. |
