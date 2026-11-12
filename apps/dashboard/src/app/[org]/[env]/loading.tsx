import { Skeleton } from '@/components/ui/skeleton';

/** Matches the Overview layout so nothing shifts when content streams in. */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-8" aria-busy>
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
