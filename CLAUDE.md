# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**Relay** — a multi-tenant webhook & event delivery platform, built as a portfolio
project to demonstrate senior full-stack engineering and system-design skills.
Design: [docs/rfc/RFC-001-relay.md](docs/rfc/RFC-001-relay.md) · Decisions: [docs/adr/](docs/adr/README.md) ·
UI/UX rules: [docs/design/ui-ux-guidelines.md](docs/design/ui-ux-guidelines.md) ·
**Progress tracker: [docs/PROGRESS.md](docs/PROGRESS.md)** (read this first when resuming).

## Constraints (do not violate)

- **TypeScript / Node.js only** (Node 24, pnpm 11, TypeScript pinned to 6.0.x — see ADR-0001).
- **No Docker on the developer's PC.** Local dev uses Neon (cloud Postgres via `.env`) and
  PGlite for tests. Docker is only for CI, Codespaces and the deployment VM.
- **Free hosting only:** Vercel (dashboard), Oracle Cloud Always Free VM (backend), Neon (Postgres).
- `.env` is gitignored and holds the Neon **direct** (non-pooled) URL with `sslmode=verify-full`.
  Never print or commit its contents.
- The developer works ~2 hours/day; plan work in session-sized chunks.

## Commands

```bash
pnpm install
pnpm build            # turbo: builds packages in dependency order
pnpm test             # all tests (PGlite, no Docker)
pnpm typecheck
pnpm lint
pnpm format           # prettier --write (CI runs format:check)
pnpm db:generate      # after editing packages/db/src/schema.ts — commit the migration
pnpm db:migrate       # apply migrations to the DATABASE_URL in .env
pnpm --filter @relay/api dev   # API at http://localhost:3000, docs at /docs
```

Before declaring work done, run the same checks as CI: `format:check`, `lint`, `build`,
`typecheck`, `test`, and `db:generate` must produce no new migration.

## Repository layout

- `apps/api` — NestJS 12 (ESM) on Fastify. `createApp()` in `src/app.ts` is shared by
  `main.ts` and tests (tests use `fastify.inject`, no network).
- `packages/shared` — prefixed ULID ids (`evt_…`), Standard Webhooks signing, retry backoff.
- `packages/db` — Drizzle schema (single file `src/schema.ts`), migrations in `drizzle/`,
  `@relay/db/testing` → `createTestDb()` (PGlite, migrated).
- `packages/queue` — `QueueTransport` interface, Postgres `SKIP LOCKED` transport, `Consumer`.

## Conventions

- ESM everywhere, `.js` extensions in relative imports, `import type` for types.
- NestJS: use **explicit `@Inject(TOKEN)`** for every constructor dependency (don't rely on
  emitted decorator metadata).
- Errors: RFC 9457 problem+json via `ProblemDetailsFilter`; never leak internals.
- IDs: always `newId('<kind>')` from `@relay/shared`; add new prefixes to `ID_PREFIXES`.
- Every tenant-owned table carries `organization_id` and `environment_id`.
- Significant technical decisions get a new ADR in `docs/adr/` (and a row in its README).
- Dashboard UI must follow `docs/design/ui-ux-guidelines.md`.

## Working agreement with the developer

1. **Git:** the developer runs `git add` / `git commit` / `git push` themselves.
   Do NOT commit or push. At the end of each piece of work, provide a ready-to-paste
   conventional commit command (`git add .`, `git commit -m "…" -m "…"`, `git push`).
2. **"stop" protocol** — when the developer says **"stop"** (or "stop for today"):
   1. Finish or safely pause the current step; never leave the build/tests broken.
      If something is half-done, note it clearly instead.
   2. Stop any running background processes (dev servers, watchers).
   3. Update [docs/PROGRESS.md](docs/PROGRESS.md): mark completed items, add a dated
      entry to the session log, and write the exact **next step**.
   4. Give the commit command for any uncommitted work.
   5. Give a **restart prompt** the developer can paste into a new session to resume.
3. **Resuming:** read `docs/PROGRESS.md` first, then continue from "Next up".
