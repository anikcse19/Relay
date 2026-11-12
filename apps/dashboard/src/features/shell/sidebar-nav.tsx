'use client';

import {
  BookOpen,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Radio,
  Settings,
  Tags,
  Webhook,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  /** Path below `/[org]/[env]`; `null` = not built yet. */
  path: string | null;
  icon: LucideIcon;
}

const ITEMS: NavItem[] = [
  { label: 'Overview', path: '', icon: LayoutDashboard },
  { label: 'Events', path: null, icon: Radio },
  { label: 'Endpoints', path: null, icon: Webhook },
  { label: 'Event types', path: null, icon: Tags },
  { label: 'API keys', path: null, icon: KeyRound },
];

const SECONDARY: NavItem[] = [{ label: 'Settings', path: null, icon: Settings }];

const DOCS_URL = process.env.NEXT_PUBLIC_API_DOCS_URL ?? 'http://localhost:3000/docs';

const itemClass =
  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0';

export function SidebarNav({ base, className }: { base: Route; className?: string }) {
  const pathname = usePathname();

  const render = ({ label, path, icon: Icon }: NavItem) => {
    if (path === null) {
      return (
        <li key={label}>
          <span
            aria-disabled
            className={cn(itemClass, 'cursor-not-allowed text-muted-foreground/60')}
            title="Coming soon"
          >
            <Icon aria-hidden />
            {label}
            <span className="ml-auto rounded-sm border px-1 text-[10px] uppercase tracking-wide">
              Soon
            </span>
          </span>
        </li>
      );
    }
    const href = `${base}${path}` as Route;
    const active = path === '' ? pathname === base : pathname.startsWith(href);
    return (
      <li key={label}>
        <Link
          href={href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            itemClass,
            active
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
        >
          <Icon aria-hidden />
          {label}
        </Link>
      </li>
    );
  };

  return (
    <nav aria-label="Main" className={cn('flex flex-col gap-4', className)}>
      <ul className="flex flex-col gap-0.5">{ITEMS.map(render)}</ul>
      <div className="h-px bg-border" />
      <ul className="flex flex-col gap-0.5">
        {SECONDARY.map(render)}
        <li>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(
              itemClass,
              'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <BookOpen aria-hidden />
            API docs
            <span aria-hidden className="ml-auto text-xs">
              ↗
            </span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      </ul>
    </nav>
  );
}
