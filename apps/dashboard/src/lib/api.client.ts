'use client';

import type { ProblemDetails } from './types';

/** A failed `/v1` call, carrying the API's RFC 9457 problem details. */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
  }
  get status() {
    return this.problem.status;
  }
}

/**
 * Browser → dashboard origin → (proxy.ts) → API. Same-origin, so the session
 * cookie and an `Origin` header (required by the API's CSRF check for writes)
 * are sent automatically.
 */
export async function apiFetch<T>(path: `/v1/${string}`, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');

  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const problem =
      body && typeof body === 'object' && 'status' in body
        ? (body as ProblemDetails)
        : { type: 'about:blank', title: 'Request failed', status: res.status };
    throw new ApiError(problem);
  }
  return body as T;
}
