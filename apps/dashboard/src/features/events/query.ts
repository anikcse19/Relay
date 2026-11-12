/** Shared by the server page and the client hooks (so not in a 'use client' module). */
export const EVENTS_PAGE_SIZE = 25;

export function eventsQueryString(filters: { type?: string }, cursor?: string): string {
  const params = new URLSearchParams({ limit: String(EVENTS_PAGE_SIZE) });
  if (filters.type) params.set('type', filters.type);
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

/** Same rule as the API, so a bad `?type=` in the URL is ignored rather than a 422. */
export function normaliseTypeFilter(value: string | string[] | undefined): string | undefined {
  const type = Array.isArray(value) ? value[0] : value;
  return type && type.length <= 100 && /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(type)
    ? type
    : undefined;
}
