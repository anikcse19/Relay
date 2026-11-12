import { CircleCheck, Circle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CopyableId } from '@/components/copyable-id';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api.server';
import type { ApiKey, Endpoint, EventSummary, Page } from '@/lib/types';
import { workspacePath } from '@/lib/workspace';
import { requireWorkspace, type WorkspaceParams } from '@/lib/workspace.server';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage({ params }: { params: WorkspaceParams }) {
  const { me, org, env } = await requireWorkspace(params);
  const firstName = me.user.name.split(' ')[0];
  const base = `/v1/environments/${env.id}` as const;
  // Four cheap reads in parallel; each list needs only one row to answer "done?".
  const [keys, endpoints, events, delivered] = await Promise.all([
    apiGet<ApiKey[]>(`${base}/api-keys`),
    apiGet<Page<Endpoint>>(`${base}/endpoints?limit=1`),
    apiGet<Page<EventSummary>>(`${base}/events?limit=1`),
    apiGet<Page<{ id: string }>>(`${base}/deliveries?status=succeeded&limit=1`),
  ]);

  const steps = [
    {
      title: 'Create an API key',
      detail: 'Authenticate your server with Relay.',
      done: (keys?.length ?? 0) > 0,
      href: workspacePath(org, env, '/api-keys'),
    },
    {
      title: 'Add an endpoint',
      detail: 'Tell Relay where to deliver webhooks.',
      done: (endpoints?.data.length ?? 0) > 0,
      href: workspacePath(org, env, '/endpoints'),
    },
    {
      title: 'Send a test event',
      detail: 'POST /v1/events with your key, or use "Send test event" on the Events page.',
      done: (events?.data.length ?? 0) > 0,
      href: workspacePath(org, env, '/events'),
    },
    {
      title: 'Inspect a successful delivery',
      detail: 'Open an event to see every attempt, request and response.',
      done: (delivered?.data.length ?? 0) > 0,
      href: workspacePath(org, env, '/events'),
    },
  ];
  const completed = steps.filter((s) => s.done).length;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {firstName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {env.kind === 'development'
            ? 'You are in Development: test keys, test endpoints, nothing reaches production.'
            : 'You are in Production: live keys and real customer endpoints.'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Get started</CardTitle>
          <CardDescription>
            From zero to a delivered, signed webhook in four steps ·{' '}
            <span className="tabular-nums">
              {completed}/{steps.length}
            </span>{' '}
            done
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3">
            {steps.map((step, i) => (
              <li key={step.title} className="flex items-start gap-3">
                {step.done ? (
                  <CircleCheck className="mt-0.5 size-4 text-success" aria-label="Done" />
                ) : (
                  <Circle className="mt-0.5 size-4 text-muted-foreground" aria-label="To do" />
                )}
                <div>
                  <p className={cn('text-sm font-medium', step.done && 'text-muted-foreground')}>
                    {i + 1}.{' '}
                    {!step.done ? (
                      <Link href={step.href} className="text-primary hover:underline">
                        {step.title}
                      </Link>
                    ) : (
                      step.title
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{org.name}</dd>
              <dt className="text-muted-foreground">Your role</dt>
              <dd className="capitalize">{org.role}</dd>
              <dt className="text-muted-foreground">ID</dt>
              <dd>
                <CopyableId value={org.id} />
              </dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Environment</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{env.name}</dd>
              <dt className="text-muted-foreground">API keys</dt>
              <dd className="font-mono text-xs leading-5">
                {env.kind === 'development' ? 'rk_test_…' : 'rk_live_…'}
              </dd>
              <dt className="text-muted-foreground">ID</dt>
              <dd>
                <CopyableId value={env.id} />
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
