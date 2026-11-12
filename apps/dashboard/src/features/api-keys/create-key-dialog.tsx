'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { CopyButton } from '@/components/copy-button';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api.client';
import type { CreatedApiKey, EnvironmentKind } from '@/lib/types';
import { useCreateApiKey } from './api';
import { curlSnippet, expiryToIso } from './helpers';

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
] as const;

/** Same limits as the API's `createApiKeySchema`. */
const formSchema = z.object({
  name: z.string().trim().min(1, 'Give the key a name').max(100, 'Use at most 100 characters'),
  expiry: z.enum(['never', '30', '90', '365']),
});
type FormValues = z.infer<typeof formSchema>;

export function CreateKeyDialog({
  environmentId,
  environmentKind,
}: {
  environmentId: string;
  environmentKind: EnvironmentKind;
}) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const create = useCreateApiKey(environmentId);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: { name: '', expiry: 'never' },
  });
  const { errors, isSubmitting } = form.formState;

  // While the secret is on screen, closing is only allowed once it's saved.
  const locked = created !== null && !acknowledged;

  function reset() {
    setCreated(null);
    setAcknowledged(false);
    create.reset();
    form.reset();
  }

  async function onSubmit({ name, expiry }: FormValues) {
    const expiresAt = expiryToIso(expiry);
    try {
      setCreated(await create.mutateAsync({ name, ...(expiresAt && { expiresAt }) }));
    } catch (error) {
      // Map server-side validation errors onto fields (guidelines §6).
      if (error instanceof ApiError && error.problem.errors) {
        for (const e of error.problem.errors) {
          if (e.path === 'name') form.setError('name', { message: e.message });
        }
      }
    }
  }

  const mode = environmentKind === 'production' ? 'live' : 'test';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> Create API key
        </Button>
      </DialogTrigger>

      <DialogContent
        hideClose={locked}
        onEscapeKeyDown={(e) => locked && e.preventDefault()}
        onPointerDownOutside={(e) => locked && e.preventDefault()}
        className={created ? 'max-w-2xl' : undefined}
      >
        {!created ? (
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                A <span className="font-mono">rk_{mode}_</span> key for this environment. Use it
                from your servers only, never in browsers or mobile apps.
              </DialogDescription>
            </div>

            {create.error && !(create.error instanceof ApiError && create.error.problem.errors) && (
              <ErrorAlert>{create.error.message}</ErrorAlert>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                placeholder="e.g. Billing service"
                autoFocus
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? 'key-name-error' : 'key-name-hint'}
                {...form.register('name')}
              />
              {errors.name ? (
                <p id="key-name-error" className="text-xs text-danger">
                  {errors.name.message}
                </p>
              ) : (
                <p id="key-name-hint" className="text-xs text-muted-foreground">
                  Name it after where it&apos;s used, so you know what breaks if you revoke it.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="key-expiry">Expires</Label>
              <select
                id="key-expiry"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                {...form.register('expiry')}
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                {isSubmitting ? 'Creating…' : 'Create key'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <DialogTitle>Save your API key</DialogTitle>
              <DialogDescription>“{created.name}” was created. Copy the key now.</DialogDescription>
            </div>

            <div
              role="note"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              This is the only time the full key is shown. Relay stores only a hash of it, so it
              can&apos;t be recovered, only revoked and replaced.
            </div>

            <div className="flex items-center gap-2">
              <code
                aria-label="API key"
                className="min-w-0 flex-1 select-all truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm"
              >
                {created.key}
              </code>
              <CopyButton value={created.key} />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Send your first event</p>
                <CopyButton value={curlSnippet(created.key)} label="Copy command" />
              </div>
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed">
                {curlSnippet(created.key)}
              </pre>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              I&apos;ve saved this key somewhere safe
            </label>

            <DialogFooter>
              <Button
                disabled={!acknowledged}
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
