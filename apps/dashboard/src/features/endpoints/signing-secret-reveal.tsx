'use client';

import { TriangleAlert } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { verifySnippet } from './helpers';

/**
 * Show-once secret (guidelines §6): warning, copy button and a ready-to-use
 * verification snippet. The parent dialog stays locked until the user
 * confirms they've saved it.
 */
export function SigningSecretReveal({
  secret,
  acknowledged,
  onAcknowledgedChange,
  note,
}: {
  secret: string;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          This is the only time the signing secret is shown. Your receiver uses it to check that a
          webhook really came from Relay. {note}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <code
          aria-label="Signing secret"
          className="min-w-0 flex-1 select-all truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm"
        >
          {secret}
        </code>
        <CopyButton value={secret} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Verify signatures (Node.js)</p>
          <CopyButton value={verifySnippet(secret)} label="Copy code" />
        </div>
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed">
          {verifySnippet(secret)}
        </pre>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={acknowledged}
          onChange={(e) => onAcknowledgedChange(e.target.checked)}
        />
        I&apos;ve saved this secret somewhere safe
      </label>
    </div>
  );
}
