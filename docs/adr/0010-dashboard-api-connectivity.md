# ADR-0010: Dashboard ↔ API connectivity and URL scheme

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

The dashboard (Next.js, Vercel) authenticates with session cookies issued by
the API (NestJS, Oracle VM). These run on different hosts. A browser calling
the API cross-origin would need CORS with credentials, and the session cookie
would be third-party, which browsers increasingly block. ADR-0007 deferred
this decision.

## Decision

### Same-origin API through the dashboard

The browser only ever talks to the dashboard's origin. `src/proxy.ts` (Next 16
"proxy", formerly middleware) forwards `/auth/*` and `/v1/*` to `API_URL`
with a transparent rewrite. Cookies are first-party, no CORS is needed, and
the API's trusted-origin and CSRF checks see the dashboard origin.

- **Runtime, not build time.** `next.config.ts` rewrites were tried first and
  rejected: Next evaluates them at **build time** and bakes the destinations
  into `routes-manifest.json`. That makes a build unable to target a
  different API (breaking build-once, deploy-anywhere), and a smoke test
  caught it sending traffic to whatever listened on the default port. The
  proxy reads `API_URL` on every request.
- **Server components** call the API directly at `API_URL`, forwarding the
  request's cookies. `getMe()` is wrapped in React `cache`, so a layout and a
  page share one call per request.
- **Production:** set `DASHBOARD_URL` on the API to the dashboard origin.
  Before enabling GitHub OAuth in production, set `BETTER_AUTH_URL` to the
  dashboard origin too, so OAuth callbacks come back through the proxy and
  set first-party cookies.

### URL scheme: `/{orgSlug}/{environmentId}/…`

- Every page has a stable, shareable URL that includes the environment
  (guidelines §3.1). The environment _id_ is used rather than its kind
  because nothing in the schema makes kind unique per org.
- Switching environment swaps only that segment and keeps the rest of the
  path.
- New users land in **Development**, so they explore with test keys.
- Workspaces the user isn't a member of render **404**, never "forbidden".
  That matches the API, so slugs and ids can't be probed.
- `typedRoutes` stays enabled. Path builders return Next's `Route` type, so
  links are still checked.

## Consequences

- One extra hop (browser → Vercel → API) for client-side API calls.
  Server-rendered reads skip it.
- The dashboard must be deployed with `API_URL`, and the API with a matching
  `DASHBOARD_URL`. Both are required config, documented in `.env.example`
  files.
- Local development must point `API_URL` at the real API port. A wrong value
  shows up as 404s from `/auth/*`.

## Alternatives considered

- **CORS + cookies with `SameSite=None; Secure` on an API subdomain:** works
  only with a custom domain shared by both apps (we're on free hosting
  domains), and third-party cookie restrictions make it fragile.
- **Bearer tokens in `localStorage`:** exposed to any XSS. httpOnly cookies
  are not.
- **`next.config.ts` rewrites:** baked in at build time (see above).
- **Hand-written route-handler proxy:** more code, plus re-implementing
  streaming and multi-`Set-Cookie` handling that the rewrite already does.
