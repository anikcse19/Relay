import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import type { Me } from '@/lib/types';
import { cn } from '@/lib/utils';
import { type Workspace, workspacePath } from '@/lib/workspace';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';
import { EnvSwitcher, OrgSwitcher } from './workspace-switchers';

/**
 * Header (org + environment switchers, account) and sidebar, per guidelines
 * §3.1. Development is visually loud (amber border + pill); production is
 * the neutral default, so the unusual state is the one that stands out.
 */
export function AppShell({
  me,
  workspace,
  children,
}: {
  me: Me;
  workspace: Workspace;
  children: ReactNode;
}) {
  const { org, env } = workspace;
  const isDev = env.kind === 'development';
  const base = workspacePath(org, env);

  return (
    <div className={cn('flex min-h-dvh flex-col', isDev && 'border-t-2 border-warning')}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 flex h-14 items-center gap-1 border-b bg-background/95 px-3 backdrop-blur">
        <Logo className="mr-2 hidden px-1 sm:inline-flex" />
        <span aria-hidden className="hidden text-muted-foreground/50 sm:inline">
          /
        </span>
        <OrgSwitcher orgs={me.organizations} current={org} />
        <span aria-hidden className="text-muted-foreground/50">
          /
        </span>
        <EnvSwitcher environments={org.environments} current={env} />
        {isDev && (
          <span className="ml-1 rounded-sm bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
            Development
          </span>
        )}
        <div className="ml-auto">
          <UserMenu name={me.user.name} email={me.user.email} />
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 border-r p-3 md:block">
          <SidebarNav base={base} />
        </aside>
        <main id="main" className="min-w-0 flex-1">
          {/* Small screens: the same navigation as a horizontal strip. */}
          <SidebarNav
            base={base}
            className="flex-row overflow-x-auto border-b p-2 md:hidden [&>div]:hidden [&_ul]:flex-row [&_ul]:gap-1"
          />
          {children}
        </main>
      </div>
    </div>
  );
}
