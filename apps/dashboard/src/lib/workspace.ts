import type { Route } from 'next';
import type { Environment, Me, Organization } from './types';

export interface Workspace {
  org: Organization;
  env: Environment;
}

/** Resolves `/[org]/[env]` URL segments against what the user can access. */
export function resolveWorkspace(me: Me, orgSlug: string, envId: string): Workspace | null {
  const org = me.organizations.find((o) => o.slug === orgSlug);
  const env = org?.environments.find((e) => e.id === envId);
  return org && env ? { org, env } : null;
}

/** Typed (`Route`) so `typedRoutes` can still check every link built from it. */
export function workspacePath(
  org: Pick<Organization, 'slug'>,
  env: Pick<Environment, 'id'>,
  subpath = '',
): Route {
  return `/${org.slug}/${env.id}${subpath}` as Route;
}

/** Same page in another environment: swaps the env segment, keeps the rest of the path. */
export function switchEnvironmentPath(pathname: string, envId: string): Route {
  const segments = pathname.split('/');
  if (segments.length >= 3) segments[2] = envId;
  return segments.join('/') as Route;
}
