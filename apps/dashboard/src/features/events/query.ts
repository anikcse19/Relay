import type { DeliveryStatus } from '@/lib/types';

/** Shared by the server page and the client hooks (so not in a 'use client' module). */
export const EVENTS_PAGE_SIZE = 25;

/**
 * Everything the events list can be filtered by; all of it lives in the URL.
 * `from`/`to`/`endpointId`/`status` come from analytics drill-downs.
 */
export interface EventFilters {
  type?: string;
  /** ISO timestamps: created at or after `from`, before `to`. */
  from?: string;
  to?: string;
  endpointId?: string;
  /** Events with a delivery in this status (to `endpointId`, if set). */
  status?: DeliveryStatus;
}

export const FILTER_KEYS = ['type', 'from', 'to', 'endpointId', 'status'] as const;

const STATUSES: readonly DeliveryStatus[] = [
  'pending',
  'retrying',
  'succeeded',
  'failed',
  'cancelled',
];

type RawParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Same rule as the API, so a bad `?type=` in the URL is ignored rather than a 422. */
export function normaliseTypeFilter(value: string | string[] | undefined): string | undefined {
  const type = first(value);
  return type && type.length <= 100 && /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(type)
    ? type
    : undefined;
}

function normaliseTime(value: string | string[] | undefined): string | undefined {
  const raw = first(value);
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * Reads filters from URL search params, dropping anything invalid (a hand-edited
 * URL shows a wider list rather than an error).
 */
export function parseEventFilters(params: RawParams): EventFilters {
  const filters: EventFilters = {};
  const type = normaliseTypeFilter(params.type);
  if (type) filters.type = type;
  const from = normaliseTime(params.from);
  const to = normaliseTime(params.to);
  if (from) filters.from = from;
  if (to && (!from || from < to)) filters.to = to;
  const endpointId = first(params.endpointId);
  if (endpointId && /^ep_[0-9A-Z]{26}$/.test(endpointId)) filters.endpointId = endpointId;
  const status = first(params.status) as DeliveryStatus | undefined;
  if (status && STATUSES.includes(status)) filters.status = status;
  return filters;
}

export function searchParamsRecord(params: URLSearchParams): RawParams {
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? undefined]));
}

export function hasFilters(filters: EventFilters): boolean {
  return FILTER_KEYS.some((key) => filters[key] !== undefined);
}

export function sameFilters(a: EventFilters, b: EventFilters): boolean {
  return FILTER_KEYS.every((key) => a[key] === b[key]);
}

export function eventsQueryString(filters: EventFilters, cursor?: string): string {
  const params = new URLSearchParams({ limit: String(EVENTS_PAGE_SIZE) });
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}
