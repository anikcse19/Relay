/**
 * Query-key factory (guidelines §10). Keys are hierarchical, so later a
 * WebSocket message can invalidate exactly what changed, e.g.
 * `queryKeys.apiKeys.all` or one environment's list.
 */
export const queryKeys = {
  apiKeys: {
    all: ['api-keys'] as const,
    list: (environmentId: string) => ['api-keys', environmentId] as const,
  },
};
