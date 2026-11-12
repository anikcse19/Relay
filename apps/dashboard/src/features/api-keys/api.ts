'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api.client';
import { queryKeys } from '@/lib/query-keys';
import type { ApiKey, CreatedApiKey } from '@/lib/types';

const keysPath = (environmentId: string) => `/v1/environments/${environmentId}/api-keys` as const;

/** Seeded with the server-rendered list, so the first paint needs no loading state. */
export function useApiKeys(environmentId: string, initialData: ApiKey[]) {
  return useQuery({
    queryKey: queryKeys.apiKeys.list(environmentId),
    queryFn: () => apiFetch<ApiKey[]>(keysPath(environmentId)),
    initialData,
  });
}

export function useCreateApiKey(environmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; expiresAt?: string }) =>
      apiFetch<CreatedApiKey>(keysPath(environmentId), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (created) => {
      // Add it to the list WITHOUT the secret: the secret lives only in the dialog.
      const listed: ApiKey = {
        id: created.id,
        name: created.name,
        keyPrefix: created.keyPrefix,
        environmentId: created.environmentId,
        createdAt: created.createdAt,
        lastUsedAt: created.lastUsedAt,
        expiresAt: created.expiresAt,
        revokedAt: created.revokedAt,
      };
      queryClient.setQueryData<ApiKey[]>(queryKeys.apiKeys.list(environmentId), (old = []) => [
        listed,
        ...old,
      ]);
    },
  });
}

/**
 * Optimistic (guidelines §6): the row shows "Revoked" immediately, and rolls
 * back with an inline error if the API refuses.
 */
export function useRevokeApiKey(environmentId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.apiKeys.list(environmentId);
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`${keysPath(environmentId)}/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiKey[]>(key);
      queryClient.setQueryData<ApiKey[]>(key, (old = []) =>
        old.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k)),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
