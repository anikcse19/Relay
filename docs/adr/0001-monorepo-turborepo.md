# ADR-0001: Monorepo with pnpm workspaces + Turborepo

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

Relay consists of several deployables (API, worker, realtime gateway, dashboard,
docs) and shared libraries (DB schema, queue, SDK, shared types). They change
together: a schema change touches the DB package, the API and the dashboard in
one logical change.

## Decision

- A single repository using **pnpm workspaces** (`apps/*`, `packages/*`).
- **Turborepo** orchestrates `build`, `test`, `typecheck` with dependency-aware
  ordering and content-hash caching.
- Internal packages compile to `dist/` with `tsc` and expose ESM via `exports`.
- TypeScript is pinned to **6.0.x** because `typescript-eslint` does not yet
  support TypeScript 7 (native compiler). Revisit when it does.

## Consequences

- ✅ Atomic cross-package changes; one PR, one CI run.
- ✅ Shared Zod schemas/types give end-to-end type safety API ↔ dashboard ↔ SDK.
- ✅ Turbo caching keeps CI fast as the repo grows.
- ⚠️ Packages must be built before dependants are type-checked (handled by `dependsOn: ["^build"]`).

## Alternatives considered

- **Polyrepo** — versioning overhead and drift between API and SDK types.
- **Nx** — more powerful, but heavier configuration than this project needs.
