/**
 * Query-key factory (guidelines §10). Keys are hierarchical, so later a
 * WebSocket message can invalidate exactly what changed, e.g.
 * `queryKeys.events.all(envId)` or one delivery.
 */
export const queryKeys = {
  apiKeys: {
    all: ['api-keys'] as const,
    list: (environmentId: string) => ['api-keys', environmentId] as const,
  },
  endpoints: {
    list: (environmentId: string) => ['endpoints', environmentId] as const,
  },
  events: {
    all: (environmentId: string) => ['events', environmentId] as const,
    list: (environmentId: string, filters: { type?: string }) =>
      ['events', environmentId, 'list', filters] as const,
    detail: (environmentId: string, id: string) => ['events', environmentId, 'detail', id] as const,
  },
  notifications: {
    list: (environmentId: string) => ['notifications', environmentId] as const,
  },
  deliveries: {
    detail: (environmentId: string, id: string) => ['deliveries', environmentId, id] as const,
  },
};
