# Architecture Decision Records

We record significant decisions using a lightweight [MADR](https://adr.github.io/madr/)-style format.
ADRs are immutable once accepted; a changed decision gets a new ADR that supersedes the old one.

| #                                             | Decision                                              | Status   |
| --------------------------------------------- | ----------------------------------------------------- | -------- |
| [0001](0001-monorepo-turborepo.md)            | Monorepo with pnpm workspaces + Turborepo             | Accepted |
| [0002](0002-postgres-first.md)                | Postgres-first architecture (storage, queue, pub/sub) | Accepted |
| [0003](0003-at-least-once-delivery.md)        | At-least-once delivery with idempotency               | Accepted |
| [0004](0004-queue-transport-abstraction.md)   | Queue transport abstraction                           | Accepted |
| [0005](0005-frontend-architecture.md)         | Dashboard frontend architecture                       | Accepted |
| [0006](0006-api-framework-and-conventions.md) | API framework (NestJS + Fastify) and HTTP conventions | Accepted |

Template: [`template.md`](template.md)
