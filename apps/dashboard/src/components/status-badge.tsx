import {
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  type LucideIcon,
  RotateCw,
  TimerOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'info' | 'warning' | 'danger' | 'muted';

/**
 * The one status vocabulary used everywhere (guidelines §2.2): always color
 * + icon + text, never color alone. Delivery and API-key states share it.
 */
const STATUSES = {
  succeeded: { tone: 'success', icon: CircleCheck, label: 'Succeeded' },
  pending: { tone: 'info', icon: Clock, label: 'Pending' },
  retrying: { tone: 'warning', icon: RotateCw, label: 'Retrying' },
  failed: { tone: 'danger', icon: CircleX, label: 'Failed' },
  cancelled: { tone: 'muted', icon: Ban, label: 'Cancelled' },
  active: { tone: 'success', icon: CircleCheck, label: 'Active' },
  revoked: { tone: 'muted', icon: Ban, label: 'Revoked' },
  expired: { tone: 'muted', icon: TimerOff, label: 'Expired' },
} satisfies Record<string, { tone: Tone; icon: LucideIcon; label: string }>;

export type Status = keyof typeof STATUSES;

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-success/10 text-success',
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  muted: 'bg-muted text-muted-foreground',
};

export function StatusBadge({
  status,
  detail,
  className,
}: {
  status: Status;
  /** Extra context after the label, e.g. "attempt 3/8". */
  detail?: string;
  className?: string;
}) {
  const { tone, icon: Icon, label } = STATUSES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
      {detail && <span className="font-normal opacity-80">· {detail}</span>}
    </span>
  );
}
