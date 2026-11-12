'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { Route } from 'next';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { SIDEBAR_COOKIE } from './constants';
import { SidebarNav } from './sidebar-nav';

/**
 * Collapsible sidebar (guidelines §3.1). The choice is stored in a cookie,
 * not localStorage, so the server renders the right width on the first byte:
 * no layout shift on load.
 */
export function Sidebar({ base, initialCollapsed }: { base: Route; initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      className={cn(
        'sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col justify-between border-r p-3 transition-[width] duration-150 ease-out md:flex',
        collapsed ? 'w-[3.75rem]' : 'w-56',
      )}
    >
      <SidebarNav base={base} collapsed={collapsed} />
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      >
        {collapsed ? (
          <PanelLeftOpen className="size-4" aria-hidden />
        ) : (
          <>
            <PanelLeftClose className="size-4" aria-hidden /> Collapse
          </>
        )}
      </button>
    </aside>
  );
}
