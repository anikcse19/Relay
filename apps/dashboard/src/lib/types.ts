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

/** A cursor-paginated list: pass `nextCursor` back as `cursor` for the next (older) page. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export type EndpointStatus = 'active' | 'paused' | 'disabled';

export interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  status: EndpointStatus;
  disabledReason: string | null;
  /** `null` = receives every event type. */
  filterEventTypes: string[] | null;
  /** Custom header values are write-only; only names come back. */
  headerNames: string[];
  secretRotatedAt: string | null;
  previousSecretExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned on create and rotate: the only times the signing secret is available. */
export interface EndpointWithSecret extends Endpoint {
  signingSecret: string;
}

export type DeliveryStatus = 'pending' | 'retrying' | 'succeeded' | 'failed' | 'cancelled';

export interface EventSummary {
  id: string;
  type: string;
  createdAt: string;
  deliveryCounts: Record<DeliveryStatus, number>;
}

export interface EventDelivery {
  id: string;
  endpointId: string;
  endpointUrl: string;
  status: DeliveryStatus;
  attemptCount: number;
  lastStatusCode: number | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
}

export interface EventDetail {
  id: string;
  type: string;
  data: Record<string, unknown>;
  idempotencyKey: string | null;
  createdAt: string;
  deliveries: EventDelivery[];
}

export interface DeliveryAttempt {
  id: string;
  attemptNumber: number;
  trigger: 'scheduled' | 'manual';
  statusCode: number | null;
  durationMs: number;
  /** `timeout` | `dns` | `connection_refused` | `connection_reset` | `tls` | `network` | `blocked_port` | `http_error` */
  errorCode: string | null;
  errorMessage: string | null;
  requestHeaders: Record<string, string> | null;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
  createdAt: string;
}

export interface DeliveryDetail extends EventDelivery {
  eventId: string;
  eventType: string;
  createdAt: string;
  /** The exact JSON body that was signed and sent. */
  requestBody: string;
  attempts: DeliveryAttempt[];
}
