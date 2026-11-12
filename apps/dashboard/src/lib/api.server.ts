import type { Route } from 'next';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { Me } from './types';
import { workspacePath } from './workspace';

/** Server-side only: the Next.js server calls the API directly (no rewrite hop). */
const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export class ApiUnavailableError extends Error {
  override name = 'ApiUnavailableError';
}

/**
 * The signed-in user with their organizations and environments, or `null`
 * when there is no valid session. Wrapped in `cache` so a layout and a page
 * rendering in the same request share one API call.
 */
export const getMe = cache(async (): Promise<Me | null> => {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/me`, { headers: { cookie }, cache: 'no-store' });
  } catch {
    throw new ApiUnavailableError('The Relay API is unreachable.');
  }
  if (res.status === 401) return null;
  if (!res.ok) throw new ApiUnavailableError(`The Relay API returned HTTP ${res.status}.`);
  return (await res.json()) as Me;
});

/** Where a signed-in user lands: their first organization, in development mode. */
export function homePath(me: Me): Route | null {
  const org = me.organizations.find((o) => o.id === me.activeOrganizationId) ?? me.organizations[0];
  // Development first: a new user should explore with test keys, not live ones.
  const env = org?.environments.find((e) => e.kind === 'development') ?? org?.environments[0];
  return org && env ? workspacePath(org, env) : null;
}
