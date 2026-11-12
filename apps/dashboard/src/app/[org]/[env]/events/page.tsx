import type { Metadata } from 'next';
import { EventsView } from '@/features/events/events-view';
import { eventsQueryString, parseEventFilters } from '@/features/events/query';
import { apiGet } from '@/lib/api.server';
import type { EventSummary, Page } from '@/lib/types';
import { workspacePath } from '@/lib/workspace';
import { requireWorkspace, type WorkspaceParams } from '@/lib/workspace.server';

export const metadata: Metadata = { title: 'Events' };

export default async function EventsPage({
  params,
  searchParams,
}: {
  params: WorkspaceParams;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org, env } = await requireWorkspace(params);
  const filters = parseEventFilters(await searchParams);
  // Server-rendered first page; the client (TanStack Query) paginates and refreshes.
  const page = await apiGet<Page<EventSummary>>(
    `/v1/environments/${env.id}/events?${eventsQueryString(filters)}`,
  );

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <EventsView
        environment={env}
        role={org.role}
        endpointsHref={workspacePath(org, env, '/endpoints')}
        initialPage={page}
        initialFilters={filters}
      />
    </div>
  );
}
