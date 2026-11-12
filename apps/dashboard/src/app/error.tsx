'use client';

import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Error state (guidelines §5): what happened, what to do, a reference for
 * support, and a retry. Never a stack trace. (In production, Next.js
 * replaces server error messages with a `digest`, so the copy can't depend
 * on the error's message.)
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">We couldn&apos;t load this page</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The dashboard may be unable to reach the Relay API right now. Your events are safe: delivery
        runs independently of the dashboard. Try again in a moment.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      )}
      <Button onClick={reset} variant="secondary">
        <RotateCw aria-hidden /> Try again
      </Button>
    </main>
  );
}
