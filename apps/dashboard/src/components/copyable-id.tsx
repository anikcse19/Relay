'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { middleTruncate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Monospace, middle-truncated ID; click to copy with a ✓ confirmation (guidelines §4.4). */
export function CopyableId({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      title={value}
      aria-label={copied ? `Copied ${value}` : `Copy ${value}`}
      onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true))}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm font-mono text-xs text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      {middleTruncate(value)}
      {copied ? (
        <Check className="size-3 text-success" aria-hidden />
      ) : (
        <Copy className="size-3" aria-hidden />
      )}
    </button>
  );
}
