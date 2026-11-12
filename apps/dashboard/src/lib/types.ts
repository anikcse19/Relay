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

export interface ApiKey {
  id: string;
  name: string;
  /** Non-secret display prefix, e.g. `rk_test_a1B2c3`. */
  keyPrefix: string;
  environmentId: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** Returned once, at creation: the only time the full secret is available. */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

/** RFC 9457 problem details, as returned by every `/v1` error. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  requestId?: string;
  errors?: { path: string; message: string }[];
}
