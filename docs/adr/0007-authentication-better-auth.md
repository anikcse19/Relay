# ADR-0007: Authentication with Better Auth, mapped onto Relay's tenancy model

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

The dashboard needs user accounts (email + password, GitHub OAuth), sessions,
and organizations with members and invitations. Every organization must start
with `Development` and `Production` environments (RFC-001 §tenancy).
Constraints: TypeScript only, free hosting, Postgres as the single datastore
(ADR-0002), and our own conventions: prefixed ULID ids, snake_case columns,
plural table names, one Drizzle schema file.

Auth is security-critical and mostly undifferentiated work, so we want a
maintained library. We still need to own the data, because tenant rows across
the system reference organizations by foreign key.

## Decision

Use **Better Auth** (1.7) with its **Drizzle adapter** and **organization plugin**.

- **Schema ownership stays with us.** Identity tables (`users`, `sessions`,
  `accounts`, `verifications`, `members`, `invitations`) are hand-written in
  `packages/db/src/schema.ts` and migrated with drizzle-kit like everything
  else. `usePlural: true` maps Better Auth's models to our plural tables.
  Drizzle _property_ names match Better Auth field names, while SQL columns stay
  snake_case.
- **Organizations are shared.** The plugin's `organization` model is our
  existing `organizations` table (gaining nullable `logo` and `metadata`
  columns). There's no separate "auth org" to keep in sync.
- **Our ids.** `advanced.database.generateId` maps every auth model to a prefix
  (`usr_`, `ses_`, `acc_`, `vrf_`, `org_`, `mem_`, `inv_`). An unknown model
  throws, so a future plugin can't silently insert unprefixed ids.
- **Provisioning.** A `user.create.after` hook calls
  `ensureDefaultOrganization()`. In **one transaction** it creates the
  organization, the owner membership and both environments. A per-user
  advisory lock plus a re-check inside the lock make it idempotent. The
  `session.create.before` hook calls it as well and sets `activeOrganizationId`.
  So a user whose sign-up crashed between "user created" and "workspace
  created" self-heals on their next sign-in.
- **Mounting.** Better Auth speaks the Fetch API. It is mounted at `/auth/*` as
  a Fastify route in an encapsulated plugin whose only content-type parser
  passes the raw body through. Nest routes authenticate with `SessionGuard`,
  which calls `auth.api.getSession()`.
- **CSRF.** Origin and Fetch-Metadata checks are **explicitly enabled**.
  Better Auth disables them by default under a test runner, which would let a
  CSRF regression pass CI. Tests cover untrusted origins, cross-site requests
  carrying a session cookie, and cross-site navigation logins.
- **Dependency hygiene.** Only `@relay/db` depends on `drizzle-orm`, and it
  re-exports the query operators. Better Auth's peer dependencies made pnpm
  resolve a second drizzle instance in the API, and its `SQL` types were
  incompatible with the schema's types.

## Consequences

- One migration history and one schema file for all data, including identity.
- `/auth/*` responses use Better Auth's JSON error shape (`{ code, message }`),
  not RFC 9457. This is a deliberate exception: the dashboard uses Better
  Auth's client, which expects that contract. All `/v1/*` routes keep problem+json.
- Session cookies (`relay.session_token`) are cookie-based. In production the
  dashboard (Vercel) should reach the API through a same-site rewrite/proxy
  so cookies stay first-party. That gets decided at deploy time (Phase 5).
- Email verification is off until a transactional email provider is added.
- Better Auth upgrades may add fields. Its runtime schema check, and the
  sign-up tests, will flag a mismatch.

## Alternatives considered

- **Auth.js (NextAuth):** centred on Next.js, while our auth lives in the
  NestJS API. It has no built-in organizations, and credentials sign-in is
  discouraged.
- **Clerk / Auth0 / WorkOS (hosted):** the best developer experience, but the
  free tiers cap users, identity data leaves our database (no FK from
  `members` to users), and it hides the system-design work this portfolio
  project exists to show.
- **Lucia / hand-rolled sessions:** Lucia is now a learning resource rather than
  a library. Hand-rolling password hashing, OAuth and invitations is a large
  security surface with no differentiation.
- **Let the Better Auth CLI generate the schema:** produces singular tables
  with string ids and a separate file, so it would fight our conventions. We
  generated the expected field list once with `getAuthTables()` and wrote the
  tables by hand.
