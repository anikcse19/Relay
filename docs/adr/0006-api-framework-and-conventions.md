# ADR-0006: API framework (NestJS + Fastify) and HTTP conventions

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

The public API is the product's front door: it must be fast on the ingest path,
self-documenting, and consistent enough that an SDK can be generated from it.
The codebase will grow to many modules (auth, endpoints, events, billing), so
structure and testability matter as much as raw speed.

## Decision

- **NestJS 12** (native ESM) for modules, dependency injection and decorators —
  a structure most backend teams recognise.
- **Fastify** as the HTTP adapter instead of Express: roughly 2× the throughput,
  built-in pino logging and schema-aware routing.
- **Explicit injection tokens** (`@Inject(SQL)`) instead of relying on emitted
  type metadata, so code behaves identically under `tsc`, Vitest and any future
  bundler.
- **App factory** (`createApp`) shared by `main.ts` and tests, so tests run the
  exact production pipeline via `fastify.inject()` — no network, no mocks.
- **Conventions:**
  - Errors: RFC 9457 Problem Details (`application/problem+json`) everywhere,
    with a `requestId`; internal error details never leak.
  - Request IDs: `x-request-id` accepted if safe (else generated as `req_…`),
    echoed on every response and attached to every log line.
  - Health: `/health/live` (process only) vs `/health/ready` (dependencies) —
    a database outage must not trigger restart loops.
  - Config: validated with Zod at boot; the process refuses to start on bad config.
  - Docs: OpenAPI at `/openapi.json`, interactive reference (Scalar) at `/docs`.

## Consequences

- ✅ Consistent, documented API surface; SDK generation from OpenAPI is straightforward.
- ✅ Fast, dependency-free integration tests.
- ⚠️ Decorator-heavy code needs `experimentalDecorators`; we isolate it to `apps/api`.

## Alternatives considered

- **Plain Fastify** — lighter, but less structure as modules multiply.
- **Hono** — excellent for edge runtimes; less mature DI/module ecosystem for a large API.
- **Express** — slower, and its middleware model offers no advantage here.
