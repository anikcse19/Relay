'use client';

import {
  KeyRound,
  Lock,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  Webhook,
} from 'lucide-react';
import { useState } from 'react';
import { CopyableId } from '@/components/copyable-id';
import { RelativeTime } from '@/components/relative-time';
import { StatusBadge } from '@/components/status-badge';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Endpoint, Environment, Role } from '@/lib/types';
import { useEndpoints, useUpdateEndpoint } from './api';
import { DeleteEndpointDialog, RotateSecretDialog } from './endpoint-dialogs';
import { EndpointFormDialog } from './endpoint-form-dialog';
import { failuresInARow, healthSummary } from './health';
import { describeFilter } from './helpers';

const MANAGE_ROLES: Role[] = ['owner', 'admin'];

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; endpoint: Endpoint }
  | { kind: 'rotate'; endpoint: Endpoint }
  | { kind: 'delete'; endpoint: Endpoint }
  | null;

export function EndpointsView({
  environment,
  role,
  initialEndpoints,
}: {
  environment: Environment;
  role: Role;
  initialEndpoints: Endpoint[];
}) {
  const { data: endpoints } = useEndpoints(environment.id, initialEndpoints);
  const update = useUpdateEndpoint(environment.id);
  const [dialog, setDialog] = useState<Dialog>(null);
  const canManage = MANAGE_ROLES.includes(role);
  const production = environment.kind === 'production';
  const target = dialog && dialog.kind !== 'create' ? dialog.endpoint : null;

  const createButton = (
    <Button onClick={() => setDialog({ kind: 'create' })}>
      <Plus aria-hidden /> Add endpoint
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Endpoints</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            URLs that receive your webhooks. Every event sent to {environment.name} is delivered to
            each active endpoint subscribed to its type, signed with that endpoint&apos;s secret.
          </p>
        </div>
        {canManage && endpoints.length > 0 && createButton}
      </div>

      {!canManage && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          You can view endpoints, but adding and changing them requires the owner or admin role.
        </div>
      )}

      {update.error && (
        <ErrorAlert>Couldn&apos;t update the endpoint: {update.error.message}</ErrorAlert>
      )}

      {endpoints.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Webhook className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <h2 className="font-semibold">No endpoints in {environment.name} yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Add the URL of your server. Relay signs every webhook so your server can verify it came
            from us, and retries automatically if your server is down.
          </p>
          {canManage ? (
            createButton
          ) : (
            <p className="text-sm text-muted-foreground">Ask an owner or admin to add one.</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">URL</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Subscribed to</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((endpoint) => (
                <tr key={endpoint.id} className="group border-b last:border-0 hover:bg-muted/30">
                  <td className="max-w-md px-4 py-2.5">
                    <p className="truncate font-mono text-xs" title={endpoint.url}>
                      {endpoint.url}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <CopyableId value={endpoint.id} />
                      {endpoint.description && (
                        <span className="truncate">· {endpoint.description}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={endpoint.status} />
                    {endpoint.disabledReason && (
                      <p className="mt-0.5 max-w-64 text-xs text-muted-foreground">
                        {endpoint.disabledReason}
                      </p>
                    )}
                    <HealthLine endpoint={endpoint} />
                    {endpoint.previousSecretExpiresAt && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Old secret valid until{' '}
                        <RelativeTime value={endpoint.previousSecretExpiresAt} />
                      </p>
                    )}
                  </td>
                  <td
                    className="px-4 py-2.5 text-xs text-muted-foreground"
                    title={endpoint.filterEventTypes?.join('\n')}
                  >
                    <span className={endpoint.filterEventTypes ? 'font-mono' : undefined}>
                      {describeFilter(endpoint.filterEventTypes)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                    <RelativeTime value={endpoint.createdAt} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${endpoint.url}`}
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', endpoint })}>
                            <Pencil aria-hidden /> Edit
                          </DropdownMenuItem>
                          {endpoint.status === 'active' ? (
                            <DropdownMenuItem
                              onSelect={() => update.mutate({ id: endpoint.id, status: 'paused' })}
                            >
                              <Pause aria-hidden /> Pause deliveries
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => update.mutate({ id: endpoint.id, status: 'active' })}
                            >
                              <Play aria-hidden />{' '}
                              {endpoint.status === 'disabled' ? 'Re-enable' : 'Resume deliveries'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() => setDialog({ kind: 'rotate', endpoint })}
                          >
                            <KeyRound aria-hidden /> Rotate secret
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-danger"
                            onSelect={() => setDialog({ kind: 'delete', endpoint })}
                          >
                            <Trash2 aria-hidden /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EndpointFormDialog
        environmentId={environment.id}
        environmentKind={environment.kind}
        endpoint={dialog?.kind === 'edit' ? dialog.endpoint : undefined}
        open={dialog?.kind === 'create' || dialog?.kind === 'edit'}
        onOpenChange={(open) => !open && setDialog(null)}
      />
      <RotateSecretDialog
        environmentId={environment.id}
        endpoint={dialog?.kind === 'rotate' ? target : null}
        onClose={() => setDialog(null)}
      />
      <DeleteEndpointDialog
        environmentId={environment.id}
        endpoint={dialog?.kind === 'delete' ? target : null}
        production={production}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

/** Health under the status badge (guidelines §1: status at a glance). */
function HealthLine({ endpoint }: { endpoint: Endpoint }) {
  const health = healthSummary(endpoint);
  if (!health) return null;
  switch (health.kind) {
    case 'circuit_open':
      return (
        <p className="mt-0.5 max-w-64 text-xs text-warning">
          {failuresInARow(health.failures)}. Deliveries are waiting so your server can recover; next
          try <RelativeTime value={health.until} />.
        </p>
      );
    case 'failing':
      return (
        <p className="mt-0.5 text-xs text-danger">
          {failuresInARow(health.failures)}, failing since <RelativeTime value={health.since} />
        </p>
      );
    case 'healthy':
      return (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Last delivered <RelativeTime value={health.lastSuccessAt} />
        </p>
      );
    case 'no_deliveries':
      return <p className="mt-0.5 text-xs text-muted-foreground">No deliveries yet</p>;
  }
}
