import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-8" aria-busy>
      <span className="sr-only">Loading endpoints…</span>
      <div className="flex justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-lg border">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-11 rounded-none" />
        ))}
      </div>
    </div>
  );
}
