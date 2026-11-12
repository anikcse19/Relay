'use client';

import { Command } from 'cmdk';
import {
  ArrowRightLeft,
  Building2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Search,
  Sun,
} from 'lucide-react';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { type ReactNode, useEffect, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { authClient } from '@/lib/auth-client';
import type { Environment, Organization } from '@/lib/types';
import { switchEnvironmentPath, workspacePath } from '@/lib/workspace';

/**
 * ⌘K / Ctrl+K command palette (guidelines §3.3): jump anywhere, switch
 * environment or organization, change theme. Fuzzy-matched by cmdk.
 */
export function CommandPalette({
  orgs,
  org,
  env,
}: {
  orgs: Organization[];
  org: Organization;
  env: Environment;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme } = useTheme();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function run(action: () => void) {
    setOpen(false);
    action();
  }
  const go = (href: Route) => run(() => router.push(href));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-56 items-center gap-2 rounded-md border bg-muted/40 px-2.5 text-sm text-muted-foreground hover:bg-muted lg:flex"
      >
        <Search className="size-3.5" aria-hidden />
        Search or jump to…
        <kbd className="ml-auto rounded-sm border bg-background px-1.5 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted lg:hidden"
      >
        <Search className="size-4" aria-hidden />
      </button>

      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Command palette"
        overlayClassName="fixed inset-0 z-50 bg-black/60"
        contentClassName="fixed left-1/2 top-[15vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border bg-popover shadow-xl"
      >
        <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <Command.Input
            placeholder="Type a command or search…"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Command.List className="max-h-80 overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
            No matching commands.
          </Command.Empty>

          <Group heading="Go to">
            <Item icon={<LayoutDashboard />} onSelect={() => go(workspacePath(org, env))}>
              Overview
            </Item>
            <Item
              icon={<KeyRound />}
              keywords={['keys', 'token', 'credentials']}
              onSelect={() => go(workspacePath(org, env, '/api-keys'))}
            >
              API keys
            </Item>
          </Group>

          {org.environments.length > 1 && (
            <Group heading="Environment">
              {org.environments
                .filter((e) => e.id !== env.id)
                .map((e) => (
                  <Item
                    key={e.id}
                    icon={<ArrowRightLeft />}
                    keywords={[e.kind, e.kind === 'production' ? 'live' : 'test']}
                    onSelect={() => go(switchEnvironmentPath(pathname, e.id))}
                  >
                    Switch to {e.name}
                  </Item>
                ))}
            </Group>
          )}

          {orgs.length > 1 && (
            <Group heading="Organization">
              {orgs
                .filter((o) => o.id !== org.id)
                .map((o) => {
                  const target =
                    o.environments.find((e) => e.kind === 'development') ?? o.environments[0];
                  return (
                    target && (
                      <Item
                        key={o.id}
                        icon={<Building2 />}
                        onSelect={() => go(workspacePath(o, target))}
                      >
                        Switch to {o.name}
                      </Item>
                    )
                  );
                })}
            </Group>
          )}

          <Group heading="Theme">
            <Item icon={<Moon />} onSelect={() => run(() => setTheme('dark'))}>
              Dark theme
            </Item>
            <Item icon={<Sun />} onSelect={() => run(() => setTheme('light'))}>
              Light theme
            </Item>
            <Item icon={<Monitor />} onSelect={() => run(() => setTheme('system'))}>
              System theme
            </Item>
          </Group>

          <Group heading="Account">
            <Item
              icon={<LogOut />}
              keywords={['logout', 'exit']}
              onSelect={() =>
                run(async () => {
                  await authClient.signOut();
                  router.replace('/sign-in');
                  router.refresh();
                })
              }
            >
              Sign out
            </Item>
          </Group>
        </Command.List>
      </Command.Dialog>
    </>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  icon,
  keywords,
  onSelect,
  children,
}: {
  icon: ReactNode;
  keywords?: string[];
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      {...(keywords && { keywords })}
      className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[selected=true]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground"
    >
      {icon}
      {children}
    </Command.Item>
  );
}
