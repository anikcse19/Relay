'use client';

import { Bell, CircleAlert, CircleCheck, CircleSlash, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { RelativeTime } from '@/components/relative-time';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { NotificationKind } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useMarkRead, useNotifications } from './api';

const KIND: Record<NotificationKind, { icon: LucideIcon; tone: string }> = {
  endpoint_failing: { icon: CircleAlert, tone: 'text-warning' },
  endpoint_disabled: { icon: CircleSlash, tone: 'text-danger' },
  endpoint_recovered: { icon: CircleCheck, tone: 'text-success' },
};

/** Header bell: endpoint health alerts for the current environment. */
export function NotificationBell({
  environmentId,
  endpointsHref,
}: {
  environmentId: string;
  endpointsHref: Route;
}) {
  const router = useRouter();
  const { data, error } = useNotifications(environmentId);
  const markRead = useMarkRead(environmentId);
  const unread = data?.unreadCount ?? 0;
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} className="relative">
          <Bell aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white tabular-nums"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Notifications">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markRead.mutate(undefined)}>
              Mark all read
            </Button>
          )}
        </div>

        {error ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Couldn&apos;t load notifications. They&apos;ll retry automatically.
          </p>
        ) : !data || data.data.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium">All quiet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You&apos;ll be told here if an endpoint starts failing, is disabled, or recovers.
            </p>
          </div>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {data.data.map((n) => {
              const { icon: Icon, tone } = KIND[n.kind];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.readAt) markRead.mutate([n.id]);
                      router.push(endpointsHref);
                    }}
                    className={cn(
                      'flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/50',
                      !n.readAt && 'bg-muted/30',
                    )}
                  >
                    <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className={cn('text-sm', !n.readAt && 'font-semibold')}>
                          {n.title}
                        </span>
                        {!n.readAt && (
                          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                            <span className="sr-only">Unread</span>
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{n.body}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        <RelativeTime value={n.createdAt} />
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
