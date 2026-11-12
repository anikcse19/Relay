import type { Metadata } from 'next';
import { ApiKeysView } from '@/features/api-keys/api-keys-view';
import { apiGet } from '@/lib/api.server';
import type { ApiKey } from '@/lib/types';
import { requireWorkspace, type WorkspaceParams } from '@/lib/workspace.server';

export const metadata: Metadata = { title: 'API keys' };

export default async function ApiKeysPage({ params }: { params: WorkspaceParams }) {
  const { org, env } = await requireWorkspace(params);
  // Server-rendered first paint; the client list (TanStack Query) takes over from here.
  const keys = (await apiGet<ApiKey[]>(`/v1/environments/${env.id}/api-keys`)) ?? [];

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <ApiKeysView environment={env} role={org.role} initialKeys={keys} />
    </div>
  );
}
