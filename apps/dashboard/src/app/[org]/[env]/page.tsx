import { CircleCheck, Circle } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { CopyableId } from '@/components/copyable-id';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMe } from '@/lib/api.server';
import { resolveWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Overview' };

// `done` becomes data-driven as each feature ships (API keys: session 6; the rest: 7–8).
const STEPS = [
  { title: 'Create an API key', detail: 'Authenticate your server with Relay.', done: false },
  { title: 'Add an endpoint', detail: 'Tell Relay where to deliver webhooks.', done: false },
  { title: 'Send a test event', detail: 'POST /v1/events with your key.', done: false },
  {
    title: 'Inspect the delivery',
    detail: 'See every attempt, request and response.',
    done: false,
  },
];

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ org: string; env: string }>;
}) {
  const me = await getMe(); // cached: shared with the layout's call
  if (!me) redirect('/sign-in');
  const { org: orgSlug, env: envId } = await params;
  const workspace = resolveWorkspace(me, orgSlug, envId);
  if (!workspace) notFound();
  const { org, env } = workspace;
  const firstName = me.user.name.split(' ')[0];

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
          <CardDescription>From zero to a delivered, signed webhook in four steps.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex items-start gap-3">
                {step.done ? (
                  <CircleCheck className="mt-0.5 size-4 text-success" aria-label="Done" />
                ) : (
                  <Circle className="mt-0.5 size-4 text-muted-foreground" aria-label="To do" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {i + 1}. {step.title}
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
