'use client';

import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { formatDayTime, formatTimeRange } from '@/lib/time';
import type { AnalyticsRange } from '@/lib/types';
import { cn } from '@/lib/utils';
import { niceTicks } from './query';

/*
 * Small SVG charts following the dataviz mark specs: thin marks (columns
 * ≤ 24 px with a 4 px rounded data end, 2 px lines), a 2 px surface gap
 * between stacked segments, hairline solid grid, one y axis, text in text
 * tokens (never the series color), a crosshair/tooltip on hover AND keyboard
 * focus, and a table view next to every chart (tooltips never gate a value).
 */

const PLOT_H = 160;
const AXIS_H = 22;
const GUTTER = 48; // y-axis labels
const PAD_RIGHT = 8;
const PAD_TOP = 8;
const SURFACE_GAP = 2;

export interface Bucket {
  start: string;
}

export interface LegendItem {
  label: string;
  color: string;
  shape: 'rect' | 'line';
}

/** Tracks the container width; 0 until mounted (charts render client-side only). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const STRIDE: Record<AnalyticsRange, number> = { '24h': 6, '7d': 4, '30d': 5 };

function axisLabel(start: string, range: AnalyticsRange): string {
  const date = new Date(start);
  return range === '24h'
    ? date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function bucketLabel(start: string, bucketMs: number): string {
  const from = new Date(start);
  return formatTimeRange(from.toISOString(), new Date(from.getTime() + bucketMs).toISOString());
}

/**
 * One focus/hover cursor per chart (roving: the chart is a single tab stop;
 * ←/→ move between buckets, Enter drills down, Esc clears).
 */
function useCursor(count: number, onActivate: (index: number) => void) {
  const [index, setIndex] = useState<number | null>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const current = index ?? count - 1;
    const moves: Record<string, number> = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowRight: Math.min(count - 1, current + 1),
      Home: 0,
      End: count - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      setIndex(moves[e.key]!);
    } else if (e.key === 'Enter' && index !== null) {
      onActivate(index);
    } else if (e.key === 'Escape') {
      setIndex(null);
    }
  };
  return {
    index,
    setIndex,
    focusProps: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => setIndex((i) => i ?? count - 1),
      onBlur: () => setIndex(null),
    },
  };
}

interface Frame {
  width: number;
  plotW: number;
  band: number;
  x: (i: number) => number;
  y: (v: number) => number;
  ticks: number[];
}

function frame(width: number, count: number, ticks: number[]): Frame {
  const plotW = Math.max(0, width - GUTTER - PAD_RIGHT);
  const band = count > 0 ? plotW / count : 0;
  const yMax = ticks.at(-1)!;
  return {
    width,
    plotW,
    band,
    x: (i) => GUTTER + band * i + band / 2,
    y: (v) => PAD_TOP + PLOT_H - (v / yMax) * PLOT_H,
    ticks,
  };
}

/** Hairline grid + y labels + sparse x labels. */
function Axes({
  f,
  buckets,
  range,
  formatY,
}: {
  f: Frame;
  buckets: Bucket[];
  range: AnalyticsRange;
  formatY: (v: number) => string;
}) {
  const stride = STRIDE[range];
  return (
    <g className="text-[10px] tabular-nums" fill="currentColor">
      {f.ticks.map((t) => (
        <g key={t}>
          <line
            x1={GUTTER}
            x2={f.width - PAD_RIGHT}
            y1={f.y(t)}
            y2={f.y(t)}
            className="stroke-border"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          <text
            x={GUTTER - 8}
            y={f.y(t)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground"
          >
            {formatY(t)}
          </text>
        </g>
      ))}
      {buckets.map((b, i) =>
        (buckets.length - 1 - i) % stride === 0 ? (
          <text
            key={b.start}
            x={f.x(i)}
            y={PAD_TOP + PLOT_H + 15}
            textAnchor="middle"
            className="fill-muted-foreground"
          >
            {axisLabel(b.start, range)}
          </text>
        ) : null,
      )}
    </g>
  );
}

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
  shape?: 'rect' | 'line';
}

/** Values lead, labels follow; keyed with the mark's shape (line keys for lines). */
function Tooltip({
  f,
  index,
  title,
  rows,
  hint,
}: {
  f: Frame;
  index: number;
  title: string;
  rows: TooltipRow[];
  hint: string;
}) {
  const left = f.x(index);
  const flip = left > f.width / 2;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
      style={flip ? { right: f.width - left + 12 } : { left: left + 12 }}
    >
      <p className="mb-1.5 font-medium text-muted-foreground">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            {row.color && <Swatch color={row.color} shape={row.shape ?? 'rect'} />}
            <span className="font-semibold tabular-nums text-foreground">{row.value}</span>
            <span className="text-muted-foreground">{row.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Swatch({ color, shape }: { color: string; shape: 'rect' | 'line' }) {
  return shape === 'line' ? (
    <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} />
  ) : (
    <span className="inline-block size-2.5 rounded-[3px]" style={{ background: color }} />
  );
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex min-h-4 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch color={item.color} shape={item.shape} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// ─── Stacked columns ────────────────────────────────────────────────────────

export interface StackSegment<K extends string> {
  key: K;
  label: string;
  color: string;
}

/**
 * Columns stacked bottom → top in `segments` order. Each segment is
 * clickable (drill into that outcome), the rest of the column drills into
 * the bucket.
 */
export function StackedColumns<K extends string, B extends Bucket & Record<K, number>>({
  label,
  buckets,
  bucketMs,
  range,
  segments,
  formatValue,
  onDrill,
}: {
  label: string;
  buckets: B[];
  bucketMs: number;
  range: AnalyticsRange;
  segments: StackSegment<K>[];
  formatValue: (v: number) => string;
  onDrill: (index: number, segment?: K) => void;
}) {
  const { ref, width } = useWidth();
  const cursor = useCursor(buckets.length, (i) => onDrill(i));
  const totals = buckets.map((b) => segments.reduce((sum, s) => sum + b[s.key], 0));
  const f = frame(width, buckets.length, niceTicks(Math.max(...totals, 0)));
  const barW = Math.max(2, Math.min(24, f.band - 4));

  return (
    <div ref={ref} className="relative" style={{ height: PAD_TOP + PLOT_H + AXIS_H }}>
      {width > 0 && (
        <svg
          width={width}
          height={PAD_TOP + PLOT_H + AXIS_H}
          role="img"
          aria-label={`${label}. Use the arrow keys to read each bar; Enter opens its events.`}
          className="overflow-visible rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          {...cursor.focusProps}
          onPointerLeave={() => cursor.setIndex(null)}
        >
          <Axes f={f} buckets={buckets} range={range} formatY={formatValue} />
          {buckets.map((b, i) => {
            let base = f.y(0);
            const visible = segments.filter((s) => b[s.key] > 0);
            const dim = cursor.index !== null && cursor.index !== i;
            return (
              <g
                key={b.start}
                opacity={dim ? 0.55 : 1}
                onPointerEnter={() => cursor.setIndex(i)}
                className="cursor-pointer"
              >
                {/* Hit area: the whole band, taller than the mark. */}
                <rect
                  x={f.x(i) - f.band / 2}
                  y={PAD_TOP}
                  width={f.band}
                  height={PLOT_H}
                  fill="transparent"
                  onClick={() => onDrill(i)}
                />
                {visible.map((s, k) => {
                  const h = (b[s.key] / f.ticks.at(-1)!) * PLOT_H;
                  const top = k === visible.length - 1;
                  // A 2 px surface gap above every segment except the top one.
                  const drawn = top ? h : Math.max(0.5, h - SURFACE_GAP);
                  const y = base - h;
                  base = y;
                  const x = f.x(i) - barW / 2;
                  return (
                    <path
                      key={s.key}
                      d={
                        top ? roundedTop(x, y, barW, drawn) : rect(x, y + (h - drawn), barW, drawn)
                      }
                      fill={s.color}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDrill(i, s.key);
                      }}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
      {width > 0 && cursor.index !== null && (
        <Tooltip
          f={f}
          index={cursor.index}
          title={bucketLabel(buckets[cursor.index]!.start, bucketMs)}
          rows={[
            ...segments
              .slice()
              .reverse()
              .map((s) => ({
                label: s.label,
                value: formatValue(buckets[cursor.index!]![s.key]),
                color: s.color,
              })),
            { label: 'total', value: formatValue(totals[cursor.index]!) },
          ]}
          hint="Click to see these events"
        />
      )}
    </div>
  );
}

function rect(x: number, y: number, w: number, h: number): string {
  return `M${x},${y}h${w}v${h}h${-w}z`;
}

/** Square at the baseline, 4 px rounded data end. */
function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}v${-(h - r)}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}v${h - r}z`;
}

// ─── Lines ──────────────────────────────────────────────────────────────────

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

/**
 * Lines over time with a crosshair that snaps to the nearest bucket; the
 * tooltip lists every series there. Gaps (no data) break the line; an
 * isolated point shows as a dot. A single series gets a 10 % area wash.
 */
export function LineChart({
  label,
  buckets,
  bucketMs,
  range,
  lines,
  yMax,
  formatValue,
  onDrill,
}: {
  label: string;
  buckets: Bucket[];
  bucketMs: number;
  range: AnalyticsRange;
  lines: LineSeries[];
  /** Fixed top of the y axis (e.g. 1 for rates); otherwise from the data. */
  yMax?: number;
  formatValue: (v: number) => string;
  onDrill: (index: number) => void;
}) {
  const { ref, width } = useWidth();
  const cursor = useCursor(buckets.length, onDrill);
  const dataMax = Math.max(0, ...lines.flatMap((l) => l.values.filter((v) => v !== null)));
  const ticks = yMax === undefined ? niceTicks(dataMax) : niceTicks(yMax, 4);
  const f = frame(width, buckets.length, ticks);
  const area = lines.length === 1;

  const onPointerMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left) / f.band);
    cursor.setIndex(Math.min(buckets.length - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} className="relative" style={{ height: PAD_TOP + PLOT_H + AXIS_H }}>
      {width > 0 && (
        <svg
          width={width}
          height={PAD_TOP + PLOT_H + AXIS_H}
          role="img"
          aria-label={`${label}. Use the arrow keys to read each point; Enter opens its events.`}
          className="overflow-visible rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          {...cursor.focusProps}
        >
          <Axes f={f} buckets={buckets} range={range} formatY={formatValue} />
          {cursor.index !== null && (
            <line
              x1={f.x(cursor.index)}
              x2={f.x(cursor.index)}
              y1={PAD_TOP}
              y2={PAD_TOP + PLOT_H}
              className="stroke-muted-foreground/50"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          )}
          {lines.map((line) => (
            <g key={line.key}>
              {runs(line.values).map((run) => {
                const points = run.map((i) => `${f.x(i)},${f.y(line.values[i]!)}`);
                return run.length === 1 ? (
                  <circle
                    key={run[0]}
                    cx={f.x(run[0]!)}
                    cy={f.y(line.values[run[0]!]!)}
                    r={3}
                    fill={line.color}
                  />
                ) : (
                  <g key={run[0]}>
                    {area && (
                      <path
                        d={`M${f.x(run[0]!)},${f.y(0)}L${points.join('L')}L${f.x(run.at(-1)!)},${f.y(0)}Z`}
                        fill={line.color}
                        opacity={0.1}
                      />
                    )}
                    <polyline
                      points={points.join(' ')}
                      fill="none"
                      stroke={line.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}
              {cursor.index !== null && line.values[cursor.index] != null && (
                // Marker with a 2 px surface ring, legible where lines cross.
                <circle
                  cx={f.x(cursor.index)}
                  cy={f.y(line.values[cursor.index]!)}
                  r={4}
                  fill={line.color}
                  className="stroke-card"
                  strokeWidth={2}
                />
              )}
            </g>
          ))}
          <rect
            x={GUTTER}
            y={PAD_TOP}
            width={f.plotW}
            height={PLOT_H}
            fill="transparent"
            className="cursor-pointer"
            onPointerMove={onPointerMove}
            onPointerLeave={() => cursor.setIndex(null)}
            onClick={() => cursor.index !== null && onDrill(cursor.index)}
          />
        </svg>
      )}
      {width > 0 && cursor.index !== null && (
        <Tooltip
          f={f}
          index={cursor.index}
          title={bucketLabel(buckets[cursor.index]!.start, bucketMs)}
          rows={lines
            .slice()
            .reverse()
            .map((line) => ({
              label: line.label,
              value:
                line.values[cursor.index!] == null
                  ? 'no data'
                  : formatValue(line.values[cursor.index!]!),
              color: line.color,
              shape: 'line' as const,
            }))}
          hint="Click to see these events"
        />
      )}
    </div>
  );
}

/** Index runs of consecutive non-null values. */
function runs(values: (number | null)[]): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) out.push(current);
      current = [];
    } else current.push(i);
  });
  if (current.length) out.push(current);
  return out;
}

// ─── Card with a chart/table toggle ─────────────────────────────────────────

/**
 * A chart card. "Table" shows the same numbers as a table: the accessible
 * twin of the chart, and how to read values without hovering.
 */
export function ChartCard({
  title,
  description,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  description: string;
  /** `[]` keeps the legend row (a single series needs none) so side-by-side plots align. */
  legend?: LegendItem[];
  table: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={cn('flex flex-col gap-3 rounded-lg border bg-card p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div
          role="group"
          aria-label={`${title}: view as`}
          className="flex rounded-md border p-0.5 text-xs"
        >
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-sm px-2 py-0.5 capitalize text-muted-foreground',
                view === v && 'bg-muted font-medium text-foreground',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {legend && view === 'chart' && <Legend items={legend} />}
      {view === 'chart' ? children : <div className="max-h-56 overflow-auto">{table}</div>}
    </section>
  );
}

/** Table twin of a time-series chart; time in the viewer's zone. */
export function SeriesTable<B extends Bucket>({
  buckets,
  columns,
}: {
  buckets: B[];
  columns: { label: string; value: (b: B) => string }[];
}) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-card text-left text-muted-foreground">
        <tr>
          <th className="py-1 pr-4 font-medium">Time</th>
          {columns.map((c) => (
            <th key={c.label} className="py-1 pr-4 text-right font-medium">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {buckets
          .slice()
          .reverse()
          .map((b) => (
            <tr key={b.start} className="border-t">
              <td className="py-1 pr-4">{formatDayTime(new Date(b.start))}</td>
              {columns.map((c) => (
                <td key={c.label} className="py-1 pr-4 text-right">
                  {c.value(b)}
                </td>
              ))}
            </tr>
          ))}
      </tbody>
    </table>
  );
}
