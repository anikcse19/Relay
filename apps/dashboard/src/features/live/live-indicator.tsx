'use client';

import { Pause, Play, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLive } from './live-provider';

const LABELS = {
  connecting: { text: 'Connecting…', dot: 'border border-muted-foreground animate-pulse' },
  live: { text: 'Live', dot: 'bg-success' },
  reconnecting: { text: 'Reconnecting…', dot: 'border border-warning animate-pulse' },
  offline: { text: 'Offline', dot: 'border border-muted-foreground' },
  paused: { text: 'Paused', dot: 'bg-muted-foreground' },
} as const;

/** ● Live / ◌ Reconnecting… / ○ Offline, with pause/resume (guidelines §4.2). */
export function LiveIndicator() {
  const live = useLive();
  if (!live) return null;
  const { text, dot } = LABELS[live.status];
  return (
    <div className="flex items-center gap-2">
      <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden className={cn('size-2 rounded-full', dot)} />
        {text}
      </span>
      {live.status === 'offline' ? (
        <Button variant="ghost" size="sm" onClick={live.reconnect}>
          <RotateCw aria-hidden /> Retry
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => live.setPaused(!live.paused)}
          aria-pressed={live.paused}
          title={live.paused ? 'Resume live updates' : 'Pause live updates'}
        >
          {live.paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {live.paused ? 'Resume' : 'Pause'}
        </Button>
      )}
    </div>
  );
}
