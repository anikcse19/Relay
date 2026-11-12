import { notFound, redirect } from 'next/navigation';
import { getMe } from './api.server';
import type { Me } from './types';
import { resolveWorkspace, type Workspace } from './workspace';

export type WorkspaceParams = Promise<{ org: string; env: string }>;

/**
 * For pages under `/[org]/[env]`: the signed-in user and the workspace in
 * the URL. Redirects to sign-in without a session; 404s for workspaces the
 * user isn't a member of. `getMe` is request-cached, so layout + page share
 * one API call.
 */
export async function requireWorkspace(params: WorkspaceParams): Promise<Workspace & { me: Me }> {
  const me = await getMe();
  if (!me) redirect('/sign-in');
  const { org, env } = await params;
  const workspace = resolveWorkspace(me, org, env);
  if (!workspace) notFound();
  return { ...workspace, me };
}
