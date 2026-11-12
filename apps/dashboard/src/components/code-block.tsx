import { CopyButton } from '@/components/copy-button';
import { cn } from '@/lib/utils';

/** Monospace block with a copy button. (Syntax highlighting + collapsing: Phase 3 JSON viewer.) */
export function CodeBlock({
  value,
  label,
  className,
}: {
  value: string;
  /** Accessible name, e.g. "Request body". */
  label: string;
  className?: string;
}) {
  return (
    <div className="relative">
      <pre
        aria-label={label}
        className={cn(
          'max-h-96 overflow-auto rounded-md border bg-muted p-3 pr-20 font-mono text-xs leading-relaxed',
          className,
        )}
      >
        {value}
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton value={value} />
      </div>
    </div>
  );
}

/** Header name/value pairs, names in monospace. */
export function HeaderList({ headers }: { headers: Record<string, string> | null }) {
  const entries = Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No headers.</p>;
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 rounded-md border p-3 font-mono text-xs">
      {entries.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
