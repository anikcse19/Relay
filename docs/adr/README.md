# Architecture Decision Records

We record significant decisions using a lightweight [MADR](https://adr.github.io/madr/)-style format.
ADRs are immutable once accepted; a changed decision gets a new ADR that supersedes the old one.

| #                                                  | Decision                                                 | Status   |
| -------------------------------------------------- | -------------------------------------------------------- | -------- |
| [0001](0001-monorepo-turborepo.md)                 | Monorepo with pnpm workspaces + Turborepo                | Accepted |
| [0002](0002-postgres-first.md)                     | Postgres-first architecture (storage, queue, pub/sub)    | Accepted |
| [0003](0003-at-least-once-delivery.md)             | At-least-once delivery with idempotency                  | Accepted |
| [0004](0004-queue-transport-abstraction.md)        | Queue transport abstraction                              | Accepted |
| [0005](0005-frontend-architecture.md)              | Dashboard frontend architecture                          | Accepted |
| [0006](0006-api-framework-and-conventions.md)      | API framework (NestJS + Fastify) and HTTP conventions    | Accepted |
| [0007](0007-authentication-better-auth.md)         | Authentication with Better Auth, mapped onto tenancy     | Accepted |
| [0008](0008-api-keys-and-event-ingestion.md)       | API keys and transactional event ingestion               | Accepted |
| [0009](0009-delivery-worker.md)                    | Delivery worker design                                   | Accepted |
| [0010](0010-dashboard-api-connectivity.md)         | Dashboard ↔ API connectivity and URL scheme              | Accepted |
| [0011](0011-tenant-routes-and-endpoint-safety.md)  | Dual-auth tenant routes, endpoint URL safety, pagination | Accepted |
| [0012](0012-connect-time-ssrf-guard-and-replay.md) | Connect-time SSRF guard and manual replay                | Accepted |
| [0013](0013-endpoint-health-circuit-breaker.md)    | Endpoint health, circuit breaker and auto-disable        | Accepted |

Template: [`template.md`](template.md)
