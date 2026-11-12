'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api.client';
import { queryKeys } from '@/lib/query-keys';
import type { Endpoint, EndpointStatus, EndpointWithSecret, Page } from '@/lib/types';
import { ENDPOINTS_PAGE_SIZE } from './constants';

export const endpointsPath = (environmentId: string) =>
  `/v1/environments/${environmentId}/endpoints` as const;

export interface EndpointInput {
  url: string;
  description: string | null;
  filterEventTypes: string[] | null;
  /** `null` = unlimited. */
  rateLimitPerSecond: number | null;
}

export function useEndpoints(environmentId: string, initialData: Endpoint[]) {
  return useQuery({
    queryKey: queryKeys.endpoints.list(environmentId),
    queryFn: async () =>
      (
        await apiFetch<Page<Endpoint>>(
          `${endpointsPath(environmentId)}?limit=${ENDPOINTS_PAGE_SIZE}`,
        )
      ).data,
    initialData,
  });
}

/** Drops the secret before caching: it lives only in the dialog that shows it. */
export function withoutSecret(endpoint: EndpointWithSecret): Endpoint {
  const copy: Partial<EndpointWithSecret> = { ...endpoint };
  delete copy.signingSecret;
  return copy as Endpoint;
}

function useReplaceInList(environmentId: string) {
  const queryClient = useQueryClient();
  return (endpoint: Endpoint) =>
    queryClient.setQueryData<Endpoint[]>(queryKeys.endpoints.list(environmentId), (old = []) =>
      old.map((e) => (e.id === endpoint.id ? endpoint : e)),
    );
}

export function useCreateEndpoint(environmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EndpointInput) =>
      apiFetch<EndpointWithSecret>(endpointsPath(environmentId), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<Endpoint[]>(queryKeys.endpoints.list(environmentId), (old = []) => [
        withoutSecret(created),
        ...old,
      ]);
    },
  });
}

export function useUpdateEndpoint(environmentId: string) {
  const replace = useReplaceInList(environmentId);
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: Partial<EndpointInput> & { id: string; status?: EndpointStatus }) =>
      apiFetch<Endpoint>(`${endpointsPath(environmentId)}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: replace,
  });
}

export function useRotateSecret(environmentId: string) {
  const replace = useReplaceInList(environmentId);
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<EndpointWithSecret>(`${endpointsPath(environmentId)}/${id}/rotate-secret`, {
        method: 'POST',
      }),
    onSuccess: (rotated) => replace(withoutSecret(rotated)),
  });
}

export function useDeleteEndpoint(environmentId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.endpoints.list(environmentId);
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`${endpointsPath(environmentId)}/${id}`, { method: 'DELETE' }),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<Endpoint[]>(key, (old = []) => old.filter((e) => e.id !== id));
      // Its deliveries are gone too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.events.all(environmentId) });
    },
  });
}
