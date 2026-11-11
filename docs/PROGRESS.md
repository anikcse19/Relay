# Progress Tracker

Roadmap for Relay (~2 hours/day, ~12 weeks). Updated at the end of every work session.

## ▶ Next up

**Phase 1 · Session 2: Authentication & organizations**

- Add Better Auth (email + password, GitHub OAuth) with its Drizzle adapter; map its
  organization/member model onto the existing `organizations` table (RFC-001 open question).
- On sign-up: create an organization with default `Development` and `Production` environments.
- Generate and apply the migration (`pnpm db:generate` → `pnpm db:migrate`).
- Tests for sign-up → org + environments created; ADR for the auth choice.

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
- [ ] **Session 2:** Auth (Better Auth) + organizations + environments
- [ ] **Session 3:** API keys + `POST /v1/events` with transactional fan-out
- [ ] **Session 4:** Delivery worker: signed HTTP delivery, attempt logging, retries
- [ ] **Sessions 5–6:** Dashboard (Next.js): design system, app shell, sign-in
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

| Date       | Session      | Done                                                                                                                     |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-11 | Phase 0      | Monorepo, RFC + 5 ADRs, UI/UX guidelines, shared/db/queue packages (31 tests), CI. Pushed to GitHub; CI green.           |
| 2026-11-12 | Phase 1 · S1 | Neon connected and migrated. API skeleton (`apps/api`), ADR-0006, CI badge. 45 tests passing. Added CLAUDE.md + tracker. |
