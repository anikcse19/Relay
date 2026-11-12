import type { Metadata } from 'next';
import { AnalyticsView } from '@/features/analytics/analytics-view';
import { analyticsQueryString, parseAnalyticsQuery } from '@/features/analytics/query';
import { apiGet } from '@/lib/api.server';
import type { Analytics } from '@/lib/types';
import { workspacePath } from '@/lib/workspace';
import { requireWorkspace, type WorkspaceParams } from '@/lib/workspace.server';

export const metadata: Metadata = { title: 'Analytics' };

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: WorkspaceParams;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org, env } = await requireWorkspace(params);
  const query = parseAnalyticsQuery(await searchParams);
  // Server-rendered numbers; the client refreshes them (and live updates nudge it).
  const data = await apiGet<Analytics>(
    `/v1/environments/${env.id}/analytics?${analyticsQueryString(query)}`,
  );

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <AnalyticsView
        environment={env}
        eventsPath={workspacePath(org, env, '/events')}
        initialQuery={query}
        initialData={data}
      />
    </div>
  );
}
