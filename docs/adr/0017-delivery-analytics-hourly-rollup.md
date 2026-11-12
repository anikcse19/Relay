# ADR-0017: Delivery analytics from an hourly rollup with latency histograms

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

The dashboard needs delivery analytics (guidelines §4.5):

- success rate over time;
- attempts stacked by outcome;
- latency p50/p95/p99, per endpoint and overall, for 24 hours, 7 days or 30 days;
- every chart drilling into the matching events.

The public API serves the same numbers.

Constraints:

- **Neon free tier (0.5 GB, ADR-0015):** raw history is pruned after 30 days.
- **Percentiles aren't additive:** a p95 can't be averaged across hours or endpoints.
- **Cheap reads:** the page loads on every visit and refreshes as deliveries happen (ADR-0016).

## Decision

### One rollup row per endpoint per UTC hour, written in the attempt's transaction

`delivery_stats_hourly`, keyed by (`endpoint_id`, `hour`), holds:

- **`succeeded`, `retried`, `failed`:** every attempt counts as exactly one of these.
  - `retried`: a failure that scheduled a retry.
  - `failed`: a failure with no retry left. That covers retries exhausted, a non-retryable response, a failed manual replay, and a failure that auto-disabled the endpoint.
  - Attempt success rate = `succeeded / attempts`.
- **`latency_histogram int[]`:** counts per fixed latency bucket, for attempts that got a response. Timeouts and connection errors aren't latency.

The worker upserts the row (`INSERT … ON CONFLICT DO UPDATE`, incrementing one array element) in the same transaction that records the attempt:

- **Always consistent:** the rollup commits if and only if the attempt does, so it can never disagree with `delivery_attempts`.
- **No new contention:** that transaction already locks the endpoint row for health (ADR-0013), so attempts on one endpoint are already serialised.
- **Database clock:** hours are `date_bin('1 hour', now(), epoch)`, which doesn't depend on the session time zone, so every worker agrees.

### Fixed log-scale histogram buckets, so percentiles merge

`LATENCY_BOUNDS_MS` in `@relay/shared` has 45 bounds from 1 ms to 60 s, giving 46 buckets.

- **Bucket width:** at most 33 % from 10 ms up.
- **Accuracy:** interpolating inside a bucket keeps estimates within a few percent (tested against exact percentiles).
- **Merging:** histograms add element-wise, so any range or endpoint set gets exact merged counts and honest percentiles. The API sums them in SQL with `unnest … WITH ORDINALITY`.
- **SQL/TypeScript agreement:** bucket `i` matches Postgres `width_bucket(ms, bounds)`. A test checks the migration's SQL bounds against the TypeScript constant.
- **The bounds can never change**, because stored rows depend on them. A different layout would need a new column.

### Reads: `GET /v1/environments/:id/analytics` (session) and `GET /v1/analytics` (API key)

- **Ranges and buckets:**

  | Range | Bucket      | Buckets |
  | ----- | ----------- | ------- |
  | `24h` | 1 hour      | 24      |
  | `7d`  | 6 hours     | 28      |
  | `30d` | 1 day (UTC) | 30      |

  The last bucket holds "now", so it is still filling.

- **Queries:** two grouped queries, counts and histogram cells per (bucket, endpoint).
- **Shaping:** the API folds them into totals, a zero-filled series and a per-endpoint table, computing percentiles from the merged histograms.
- **Optional filter:** `endpointId`.

### Drill-down: the events list gains `from`, `to`, `endpointId` and `status` filters

- **Time:** `from`/`to` become bounds on the time-sortable event id (`idAt()`), so they use the existing (environment, id) index.
- **Endpoint and status:** `endpointId`/`status` add an `EXISTS` on the event's deliveries.
- **Mapping:**
  - A chart click opens the bucket's events, narrowed to the endpoint.
  - "Succeeded" and "Failed" segments map to that delivery status.
  - "Retried" maps to no status, because those deliveries have since moved on.
- **Time basis differs:** the events list filters by event creation time, while the chart buckets by attempt time. They match except for retries that cross a bucket edge, so the chip says "Created".

### Retention, backfill and live refresh

- **Retention:** rollups are kept for `max(RETENTION_DAYS, 90)` days. The rows are small, so trends outlive raw history.
- **Backfill:** the migration rebuilds the rollup from the attempts still retained. A test checks the backfill reproduces the live rollup exactly.
- **Live refresh:** the dashboard refetches analytics at most every 3 s while `delivery.updated` messages stream in, and only while a chart is on screen.

### Charts: hand-written SVG, following the dataviz method

No chart library, so nothing is added to the bundle and every mark follows the spec:

- **Marks:** columns at most 24 px wide with a 4 px rounded top, 2 px surface gaps between stacked segments, 2 px lines.
- **Axes:** hairline grids and one y axis.
- **Hover:** a crosshair tooltip listing every series.
- **Keyboard:** each chart is one tab stop. ←/→ move between buckets and Enter drills down.
- **Table view:** every chart has a table twin.

Colours were checked with the palette validator:

- **Outcome stack:** fixed status steps, green → amber → red in stack order. That order passes CVD separation. Every darker amber collapses into green for protanopes, so amber stays light, with the legend, tooltip and table as relief.
- **Latency:** a one-hue ordinal blue ramp, stepped separately for light and dark.

## Consequences

- **Cheap reads:** at most 24–720 rows per endpoint, whatever the traffic.
- **Cheap writes:** one extra upsert per attempt, on a row the transaction effectively owns.
- **Percentiles are estimates:** within the bucket width, not exact. That's the standard trade (Prometheus histograms, HdrHistogram).
- **Hour granularity:** no per-minute view. A finer table would be a separate rollup.
- **Deleted endpoints:** their rollups are deleted with them (FK cascade), matching how deliveries already behave.
- **Shutdown fix (found during this session):** the API's `LiveHub` now ends open SSE streams before the server closes. Before this, an open dashboard tab made restarts and deploys hang, because the server waited forever for the stream to finish.

## Alternatives considered

- **Query `delivery_attempts` directly** (`percentile_cont` per bucket):
  - exact, but cost grows with traffic;
  - percentiles can't be cached or merged;
  - history is limited to raw retention.
- **Rollup by a periodic job** instead of in the attempt transaction: needs watermarks and late-data handling, lags the live dashboard, and can drift from the attempts.
- **Store p50/p95/p99 per hour:** percentiles can't be combined across hours or endpoints, so 7d/30d and "all endpoints" would be wrong.
- **t-digest / DDSketch:** more accurate at the tails, but needs an extension or opaque blobs. A fixed histogram is plain SQL and good enough here.
- **A chart library (Recharts, visx):** extra bundle weight and harder to hold to the mark and accessibility specs than about 400 lines of owned SVG.
