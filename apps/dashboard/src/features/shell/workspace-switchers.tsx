'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Environment, Organization } from '@/lib/types';
import { cn } from '@/lib/utils';
import { switchEnvironmentPath, workspacePath } from '@/lib/workspace';

const triggerClass =
  'inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-muted data-[state=open]:bg-muted';

export function OrgSwitcher({ orgs, current }: { orgs: Organization[]; current: Organization }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass} aria-label={`Organization: ${current.name}`}>
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-sm bg-primary text-[11px] font-semibold text-primary-foreground"
        >
          {current.name[0]?.toUpperCase()}
        </span>
        <span className="max-w-40 truncate">{current.name}</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {orgs.map((org) => {
          const env = org.environments.find((e) => e.kind === 'development') ?? org.environments[0];
          return (
            <DropdownMenuItem
              key={org.id}
              disabled={!env}
              onSelect={() => env && router.push(workspacePath(org, env))}
            >
              <span className="truncate">{org.name}</span>
              <span className="ml-auto text-xs capitalize text-muted-foreground">{org.role}</span>
              {org.id === current.id && <Check aria-label="Current" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EnvSwitcher({
  environments,
  current,
}: {
  environments: Environment[];
  current: Environment;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isDev = current.kind === 'development';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass} aria-label={`Environment: ${current.name}`}>
        <span
          aria-hidden
          className={cn('size-2 rounded-full', isDev ? 'bg-warning' : 'bg-success')}
        />
        {current.name}
        <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Environment</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current.id}
          onValueChange={(id) => router.push(switchEnvironmentPath(pathname, id))}
        >
          {environments.map((env) => (
            <DropdownMenuRadioItem key={env.id} value={env.id}>
              {env.name}
              <span className="ml-auto pl-4 text-xs text-muted-foreground">
                {env.kind === 'development' ? 'test keys' : 'live keys'}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
