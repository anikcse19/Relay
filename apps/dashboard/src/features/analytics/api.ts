'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api.client';
import { queryKeys } from '@/lib/query-keys';
import type { Analytics } from '@/lib/types';
import { type AnalyticsQuery, analyticsQueryString } from './query';

/** The rollup changes with every attempt; the live provider refreshes it, this is the backstop. */
const REFRESH_MS = 60_000;

/**
 * Analytics for the current filters. The server-rendered result seeds the
 * cache for the filters it was rendered with; when filters change, the
 * previous result stays on screen (dimmed) until the new one arrives,
 * rather than flashing skeletons (dataviz: refetch keeps the frame).
 */
export function useAnalytics(
  environmentId: string,
  query: AnalyticsQuery,
  initialData: Analytics | null,
) {
  return useQuery({
    queryKey: queryKeys.analytics.get(environmentId, query),
    queryFn: () =>
      apiFetch<Analytics>(
        `/v1/environments/${environmentId}/analytics?${analyticsQueryString(query)}`,
      ),
    ...(initialData && { initialData }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
}
