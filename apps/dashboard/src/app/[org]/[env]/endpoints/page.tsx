import type { Metadata } from 'next';
import { ENDPOINTS_PAGE_SIZE } from '@/features/endpoints/constants';
import { EndpointsView } from '@/features/endpoints/endpoints-view';
import { apiGet } from '@/lib/api.server';
import type { Endpoint, Page } from '@/lib/types';
import { requireWorkspace, type WorkspaceParams } from '@/lib/workspace.server';

export const metadata: Metadata = { title: 'Endpoints' };

export default async function EndpointsPage({ params }: { params: WorkspaceParams }) {
  const { org, env } = await requireWorkspace(params);
  const page = await apiGet<Page<Endpoint>>(
    `/v1/environments/${env.id}/endpoints?limit=${ENDPOINTS_PAGE_SIZE}`,
  );

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <EndpointsView environment={env} role={org.role} initialEndpoints={page?.data ?? []} />
    </div>
  );
}
