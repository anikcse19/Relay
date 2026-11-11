# ADR-0005: Dashboard frontend architecture

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

The dashboard is the most visible part of the project. It must feel fast, handle
large and live-updating datasets (event logs), and stay maintainable as features
grow. See [UI/UX guidelines](../design/ui-ux-guidelines.md) for the product-level patterns.

## Decision

| Concern       | Choice                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| Framework     | Next.js App Router — Server Components for data-heavy pages, streaming with Suspense  |
| Components    | shadcn/ui on Radix primitives (accessible, owned source code) + Tailwind CSS          |
| Design tokens | CSS variables (color, radius, spacing) → Tailwind theme; light & dark themes          |
| Server state  | TanStack Query (client), with WebSocket messages invalidating/patching the cache      |
| URL state     | Filters, search, pagination, selected item live in the URL (`nuqs`)                   |
| Forms         | react-hook-form + Zod schemas **shared with the API**                                 |
| Tables        | TanStack Table + TanStack Virtual for large/live lists                                |
| Structure     | Feature-based folders (`features/endpoints/{components,api,hooks}`)                   |
| Quality       | Storybook for components, Playwright E2E + visual snapshots, axe accessibility checks |

## Consequences

- ✅ Shareable deep links for any view (e.g. a filtered list of failed deliveries).
- ✅ One source of truth for validation across API, dashboard and SDK.
- ⚠️ Mixing Server and Client Components requires discipline about boundaries.
