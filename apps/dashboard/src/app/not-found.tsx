import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page doesn&apos;t exist, or it belongs to a workspace you&apos;re not a member of.
      </p>
      <Button asChild variant="secondary">
        <Link href="/">Go to your workspace</Link>
      </Button>
    </main>
  );
}
