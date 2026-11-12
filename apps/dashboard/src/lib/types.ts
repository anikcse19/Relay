/**
 * API response shapes used by the dashboard.
 * TODO(Phase 4): generate from the API's OpenAPI document (guidelines §10,
 * "Typed API client") so the dashboard and the public SDK share one source.
 */
export type Role = 'owner' | 'admin' | 'member';
export type EnvironmentKind = 'development' | 'production';

export interface Environment {
  id: string;
  name: string;
  kind: EnvironmentKind;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: Role;
  environments: Environment[];
}

export interface Me {
  user: { id: string; name: string; email: string; emailVerified: boolean; image: string | null };
  activeOrganizationId: string | null;
  organizations: Organization[];
}
