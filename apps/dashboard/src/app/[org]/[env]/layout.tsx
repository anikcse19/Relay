import type { ReactNode } from 'react';
import { AppShell } from '@/features/shell/app-shell';
import { requireWorkspace, type WorkspaceParams } from '@/lib/workspace.server';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: WorkspaceParams;
}) {
  // Not a member (or no such workspace) → 404, never "forbidden", so other
  // tenants' slugs and ids can't be probed (same policy as the API).
  const { me, org, env } = await requireWorkspace(params);
  return (
    <AppShell me={me} workspace={{ org, env }}>
      {children}
    </AppShell>
  );
}
