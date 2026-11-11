# Relay — UI/UX Guidelines

> **North star:** a developer debugging a failed webhook at 2 a.m. should find the
> cause in **under 30 seconds** and fix it in **one click**.

Relay's users are developers. They value speed, density, keyboard control and
precise information over decoration. The visual language takes cues from the
best developer tools (calm, dense, monochrome UI with color used only to carry meaning).

---

## 1. Design principles

| Principle                   | What it means in practice                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Clarity over cleverness** | Plain labels ("Failed", not "Oopsie"). Exact numbers and timestamps. No mystery-meat icons without labels/tooltips.           |
| **Status at a glance**      | The health of every endpoint and delivery is visible without clicking. Color + icon + text, never color alone.                |
| **Fast by default**         | Interactions respond in < 100 ms (optimistic UI), pages stream in with skeletons, lists virtualize.                           |
| **Keyboard-first**          | Every action reachable by keyboard; ⌘K command palette; list navigation with `j`/`k`.                                         |
| **Progressive disclosure**  | Summaries first, details on demand (row → drawer → full page). Advanced settings behind "Advanced".                           |
| **Safe by design**          | Destructive actions are reversible (undo) or require explicit confirmation. Production is visually distinct from development. |

---

## 2. Design system foundations

### 2.1 Tokens (CSS variables → Tailwind)

```css
:root {
  /* Neutrals carry 90% of the UI */
  --background; --foreground; --muted; --muted-foreground; --border; --card;
  /* Brand — used sparingly: primary buttons, focus ring, selection */
  --primary; --primary-foreground; --ring;
  /* Semantic status — the ONLY other colors in the product */
  --success;  /* delivered, endpoint healthy        */
  --warning;  /* retrying, degraded, rate-limited   */
  --danger;   /* failed, disabled, destructive      */
  --info;     /* pending, in progress               */
  --radius: 0.5rem;
}
```

- **Spacing:** 4 px base scale (4, 8, 12, 16, 24, 32, 48). No arbitrary values.
- **Typography:** Inter (UI) + JetBrains Mono (IDs, payloads, code, URLs, numbers in tables).
  Use `tabular-nums` for all numeric columns so digits align.
- **Elevation:** borders over shadows. Shadows only for overlays (popover, dialog, toast).
- **Motion:** 150–200 ms, ease-out, for state changes only. Respect `prefers-reduced-motion`.
- **Themes:** light and dark from day one (dark is the default for a dev tool); both meet WCAG AA contrast.

### 2.2 Status vocabulary (used everywhere identically)

| State     | Color   | Icon           | Label                  |
| --------- | ------- | -------------- | ---------------------- |
| Succeeded | success | ✓ check-circle | Succeeded              |
| Pending   | info    | ◷ clock        | Pending                |
| Retrying  | warning | ↻ rotate       | Retrying · attempt 3/8 |
| Failed    | danger  | ✕ x-circle     | Failed                 |
| Cancelled | muted   | ⊘ ban          | Cancelled              |

One `<StatusBadge status=… />` component renders all of these. Consistency is the pattern.

---

## 3. Layout & navigation patterns

### 3.1 App shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◆ Acme ▾  │ ● Production ▾ │          ⌘K Search…        │ ? │ 🔔 │ (A) │
├───────────┼──────────────────────────────────────────────────────────┤
│ Overview  │  Endpoints / ep_01JD…  (breadcrumbs)                     │
│ Events    │                                                          │
│ Endpoints │   Page content                                           │
│ Event     │                                                          │
│  types    │                                                          │
│ API keys  │                                                          │
│ ───────── │                                                          │
│ Settings  │                                                          │
│ Docs ↗    │                                                          │
└───────────┴──────────────────────────────────────────────────────────┘
```

- **Org switcher** + **environment switcher** always visible in the header.
- **Collapsible sidebar** (icon-only mode remembered per user).
- **Breadcrumbs** for nested resources; every page has a stable, shareable URL.

### 3.2 Environment safety (Stripe-style test/live mode)

- Development environment shows a persistent amber top border + "DEVELOPMENT" pill.
- Production is the neutral default, so the _unusual_ state is the visually loud one.
- Destructive actions in production require typing the resource name.

### 3.3 Command palette (⌘K / Ctrl+K)

Global fuzzy search + actions: jump to any endpoint/event by ID (paste `evt_…`
and press Enter), switch environment, "Create endpoint", "Send test event",
toggle theme. Recently visited items appear first.

### 3.4 Master–detail with drawers

Lists open details in a **right-side sheet** (keeps list context and scroll
position), with "Open full page ↗" for deep inspection. The selected item lives
in the URL (`?delivery=dlv_…`) so it is linkable and survives refresh.

---

## 4. Data display patterns

### 4.1 Data tables

- Server-side **cursor pagination** (IDs are time-sortable), never offset.
- **Filters as chips** above the table (`Status: Failed ×`, `Endpoint: billing ×`, `Last 24h ×`),
  all persisted in the URL → shareable "views". Save frequent views (Phase 3).
- **Density toggle** (comfortable/compact). Sticky header. Column visibility menu.
- **Virtualized rows** for long lists (TanStack Virtual).
- Row hover reveals quick actions (Replay, Copy ID) instead of permanent button clutter.

### 4.2 Live tail (real-time event stream)

```
┌ Events ───────────────────────── ● Live  [Pause] ┐
│        ┌──────────────────────┐                  │
│        │ ↑ 12 new events      │  ← pill, not a   │
│        └──────────────────────┘    scroll jump   │
│ ✓ invoice.paid      evt_01JD…   212 ms   just now│
│ ↻ customer.updated  evt_01JD…   timeout   3s ago │
```

- New items **never shift what the user is reading**. If scrolled down or
  hovering, buffer and show a "↑ N new events" pill.
- Pause/resume; auto-pause when the tab is hidden; throttle UI updates (~4/s) under load.
- New rows get a brief highlight fade (200 ms), disabled under reduced motion.
- Connection indicator: ● Live / ◌ Reconnecting… / ○ Offline (with retry).

### 4.3 Delivery inspector (the most important screen)

```
┌ dlv_01JD… ─ invoice.paid → https://api.acme.com/hooks ──── [Replay] ┐
│ Status: ✕ Failed after 8 attempts      Last: 503 · 30 012 ms         │
│                                                                      │
│ Timeline                                                             │
│  ●── 1  10:00:01  503  1.2s                                          │
│  ●── 2  10:00:07  503  1.1s   (+6s)                                  │
│  ●── 3  10:00:31  timeout     (+24s)                                 │
│  …                                                                   │
│ ┌ Request ─┬ Response ─┬ Headers ─┐   ✨ Explain this failure         │
│ │ { "type": "invoice.paid", … }   │                                  │
└──────────────────────────────────────────────────────────────────────┘
```

- **Timeline** of attempts with deltas, so retry behaviour is visible.
- **Error classification in plain English**: "Connection timed out after 30 s —
  your server didn't respond. Check that it returns 2xx within 15 s."
- JSON viewer: syntax highlighting, collapsible nodes, copy path/value, search.
- **AI "Explain this failure"** (Phase 4): suggestion panel, clearly labelled as AI, never auto-acts.

### 4.4 Identifiers, time and numbers

- IDs in monospace, middle-truncated (`evt_01JD…X4QZ`), **click to copy** with a ✓ confirmation.
- Relative time ("3 min ago") with absolute UTC + local time in a tooltip.
- Durations humanized (`212 ms`, `1.2 s`); large counts abbreviated with exact value on hover (`12.4k`).

### 4.5 Charts (overview & endpoint health)

- Success rate and latency (p50/p95/p99) over time; deliveries stacked by status.
- Semantic colors only (success/warning/danger); clear axes and units; hover tooltips with exact values.
- Every chart is clickable → drills into the filtered event list for that time range.

---

## 5. State patterns — design every state, not just the happy path

| State                      | Pattern                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading**                | Skeletons that match the final layout (no layout shift). Spinners only for in-button actions.                                                                                      |
| **Empty (first run)**      | Educational: what this is + primary CTA + copy-paste code snippet. e.g. _"No events yet — send your first one:"_ followed by a `curl` example with the user's real API key prefix. |
| **Empty (filtered)**       | "No failed deliveries in the last 24h 🎉" + "Clear filters".                                                                                                                       |
| **Error**                  | What happened, why, what to do, plus a request ID for support. Retry button. Never a raw stack trace.                                                                              |
| **Partial**                | If one panel fails, the rest of the page still renders (per-section error boundaries).                                                                                             |
| **Offline / reconnecting** | Non-blocking banner; stale data marked; auto-retry with backoff.                                                                                                                   |
| **Permission denied**      | Explain which role is needed and who the org owners are.                                                                                                                           |

---

## 6. Interaction & feedback patterns

- **Optimistic updates** for fast, low-risk actions (pause endpoint, replay) with rollback + error toast on failure.
- **Undo over confirm** for reversible actions ("Endpoint paused · Undo").
  **Confirm dialogs** only for irreversible ones (delete, rotate secret), stating the consequence.
- **Secrets shown once**: API key / signing secret creation shows the value with Copy,
  a "I've saved this" checkbox, and a warning that it won't be shown again.
- **Inline validation** on blur, using the same Zod schemas as the API; server errors map onto fields.
- **Toasts** for background results only; never for errors the user must act on (use inline errors).
- **Keyboard shortcuts**: `⌘K` palette, `/` focus search, `j`/`k` move selection, `Enter` open,
  `Esc` close drawer, `r` replay, `?` shortcut cheat-sheet.

---

## 7. Onboarding & developer experience

1. **Getting-started checklist** on Overview (create key → add endpoint → send test event → see delivery), with progress.
2. **"Send test event"** button on every endpoint, using a sample payload for the chosen event type.
3. **Code snippets** in tabs (cURL, Node, Python, Go) pre-filled with the user's real IDs.
4. **Signature verification guide** with copyable code for the receiver side.
5. **Demo mode**: seeded account with realistic traffic, so recruiters can explore without signing up.

---

## 8. Accessibility (WCAG 2.2 AA)

- Radix primitives → correct roles, focus management and keyboard support in menus/dialogs.
- Visible focus ring on every interactive element; logical tab order; skip-to-content link.
- Color is never the only signal (status = icon + text + color).
- Live stream uses a throttled, polite `aria-live` summary ("5 new events"), not per-row announcements.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Automated `axe` checks in Playwright on every page; manual keyboard-only pass per feature.

---

## 9. Responsive strategy

Desktop-first (the primary use is debugging at a desk), but fully usable on
mobile for on-call checks: sidebar → bottom sheet, tables → card lists,
drawers → full-screen sheets. Breakpoints: `sm 640`, `md 768`, `lg 1024`, `xl 1280`.

---

## 10. Frontend engineering patterns

| Pattern                           | Use                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Feature-sliced folders**        | `features/<domain>/{components,api,hooks,schemas}`. Shared UI in `components/ui`.                    |
| **Server Components for reads**   | Fetch on the server, stream with `<Suspense>`; client components only where interactive.             |
| **URL as state**                  | Filters, tabs, selection, pagination → query params (shareable, back-button friendly).               |
| **Query-key factory**             | Central `queryKeys.deliveries.list(filters)` so WebSocket events can invalidate precisely.           |
| **Compound components**           | `<DataTable>`, `<DataTable.Toolbar>`, `<DataTable.Pagination>` for flexible, consistent composition. |
| **Headless logic + styled shell** | Hooks (`useLiveTail`, `useCopyToClipboard`) hold behaviour; components stay presentational.          |
| **Error boundaries per section**  | Implements the "partial" state pattern.                                                              |
| **Typed API client**              | Generated from OpenAPI → dashboard and public SDK share types.                                       |

## 11. Quality gates

- **Storybook** documents every component in every state (loading/empty/error/dark).
- **Playwright** E2E for critical journeys + visual regression snapshots.
- **Lighthouse CI** budgets: Performance ≥ 90, Accessibility 100.
- **Core Web Vitals** targets: LCP < 2.5 s, INP < 200 ms, CLS < 0.1.
