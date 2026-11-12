'use client';

import { KeyRound, Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { RelativeTime } from '@/components/relative-time';
import { StatusBadge } from '@/components/status-badge';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ApiKey, Environment, Role } from '@/lib/types';
import { useApiKeys, useRevokeApiKey } from './api';
import { CreateKeyDialog } from './create-key-dialog';
import { keyStatus } from './key-status';
import { RevokeKeyDialog } from './revoke-key-dialog';

const MANAGE_ROLES: Role[] = ['owner', 'admin'];

export function ApiKeysView({
  environment,
  role,
  initialKeys,
}: {
  environment: Environment;
  role: Role;
  initialKeys: ApiKey[];
}) {
  const { data: keys } = useApiKeys(environment.id, initialKeys);
  const revoke = useRevokeApiKey(environment.id);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const canManage = MANAGE_ROLES.includes(role);
  const production = environment.kind === 'production';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Keys authenticate your servers when they send events. Each key belongs to one
            environment: {production ? 'live' : 'test'} keys only see {environment.name}.
          </p>
        </div>
        {canManage && keys.length > 0 && (
          <CreateKeyDialog environmentId={environment.id} environmentKind={environment.kind} />
        )}
      </div>

      {!canManage && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          You can view keys, but creating and revoking them requires the owner or admin role. Ask an
          owner of this organization to change your role.
        </div>
      )}

      {revoke.error && (
        <ErrorAlert>
          Couldn&apos;t revoke the key: {revoke.error.message} The key is still active.
        </ErrorAlert>
      )}

      {keys.length === 0 ? (
        <EmptyState environment={environment} canManage={canManage} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const status = keyStatus(key);
                return (
                  <tr key={key.id} className="group border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{key.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {key.keyPrefix}…
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={status} />
                      {status === 'active' && key.expiresAt && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          expires <RelativeTime value={key.expiresAt} />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                      <RelativeTime value={key.createdAt} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                      {key.lastUsedAt ? <RelativeTime value={key.lastUsedAt} /> : 'Never'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canManage && status !== 'revoked' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          // Quick action revealed on hover/focus (guidelines §4.1).
                          className="text-danger opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() => setRevoking(key)}
                          aria-label={`Revoke ${key.name}`}
                        >
                          <Trash2 aria-hidden /> Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <RevokeKeyDialog
        apiKey={revoking}
        production={production}
        onClose={() => setRevoking(null)}
        onConfirm={(key) => {
          setRevoking(null);
          revoke.mutate(key.id);
        }}
      />
    </div>
  );
}

/** First-run empty state: what this is, why, and the primary action (guidelines §5). */
function EmptyState({ environment, canManage }: { environment: Environment; canManage: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <KeyRound className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="font-semibold">No API keys in {environment.name} yet</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Create a key, then send your first event with a single{' '}
        <span className="font-mono">curl</span> command. We&apos;ll show you the exact command with
        your key filled in.
      </p>
      {canManage ? (
        <CreateKeyDialog environmentId={environment.id} environmentKind={environment.kind} />
      ) : (
        <p className="text-sm text-muted-foreground">Ask an owner or admin to create one.</p>
      )}
    </div>
  );
}
