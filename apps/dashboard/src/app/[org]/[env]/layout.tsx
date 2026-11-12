import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/features/shell/app-shell';
import { getMe } from '@/lib/api.server';
import { resolveWorkspace } from '@/lib/workspace';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ org: string; env: string }>;
}) {
  const me = await getMe();
  if (!me) redirect('/sign-in');

  const { org, env } = await params;
  const workspace = resolveWorkspace(me, org, env);
  // Not a member (or no such workspace): 404, never "forbidden", so other
  // tenants' slugs and ids can't be probed (same policy as the API).
  if (!workspace) notFound();

  return (
    <AppShell me={me} workspace={workspace}>
      {children}
    </AppShell>
  );
}
