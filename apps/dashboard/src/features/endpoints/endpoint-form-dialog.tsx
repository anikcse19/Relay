'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api.client';
import type { Endpoint, EndpointWithSecret, EnvironmentKind } from '@/lib/types';
import { useCreateEndpoint, useUpdateEndpoint } from './api';
import { invalidEventType, parseEventTypes } from './helpers';
import { SigningSecretReveal } from './signing-secret-reveal';

const formSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Enter the URL Relay should POST to')
    .max(2048, 'Use at most 2048 characters')
    .refine((v) => URL.canParse(v), 'Enter a full URL, e.g. https://example.com/webhooks'),
  description: z.string().trim().max(500, 'Use at most 500 characters'),
  eventTypes: z.string().superRefine((value, ctx) => {
    const bad = invalidEventType(value);
    if (bad) ctx.addIssue({ code: 'custom', message: `“${bad}” isn't a valid event type` });
  }),
});
type FormValues = z.infer<typeof formSchema>;

/**
 * Create (then show the signing secret once) or edit an endpoint.
 * `endpoint` = edit mode. Controlled by the parent via `open`.
 */
export function EndpointFormDialog({
  environmentId,
  environmentKind,
  endpoint,
  open,
  onOpenChange,
}: {
  environmentId: string;
  environmentKind: EnvironmentKind;
  endpoint?: Endpoint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateEndpoint(environmentId);
  const update = useUpdateEndpoint(environmentId);
  const mutation = endpoint ? update : create;
  const [created, setCreated] = useState<EndpointWithSecret | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    values: {
      url: endpoint?.url ?? '',
      description: endpoint?.description ?? '',
      eventTypes: endpoint?.filterEventTypes?.join(', ') ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const locked = created !== null && !acknowledged;

  function close() {
    onOpenChange(false);
    setCreated(null);
    setAcknowledged(false);
    create.reset();
    update.reset();
    form.reset();
  }

  async function onSubmit(values: FormValues) {
    const input = {
      url: values.url,
      description: values.description || null,
      filterEventTypes: parseEventTypes(values.eventTypes),
    };
    try {
      if (endpoint) {
        await update.mutateAsync({ id: endpoint.id, ...input });
        close();
      } else {
        setCreated(await create.mutateAsync(input));
      }
    } catch (error) {
      // Server-side checks (e.g. the production URL policy) land on the field.
      if (error instanceof ApiError && error.problem.errors) {
        for (const e of error.problem.errors) {
          if (e.path === 'url') form.setError('url', { message: e.message });
          if (e.path === 'description') form.setError('description', { message: e.message });
          if (e.path.startsWith('filterEventTypes')) {
            form.setError('eventTypes', { message: e.message });
          }
        }
      }
    }
  }

  const fieldError = (id: string, message?: string, hint?: string) =>
    message ? (
      <p id={`${id}-error`} className="text-xs text-danger">
        {message}
      </p>
    ) : hint ? (
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
    ) : null;

  const unmappedError =
    mutation.error && !(mutation.error instanceof ApiError && mutation.error.problem.errors);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : !locked && close())}>
      <DialogContent
        hideClose={locked}
        onEscapeKeyDown={(e) => locked && e.preventDefault()}
        onPointerDownOutside={(e) => locked && e.preventDefault()}
        className={created ? 'max-w-2xl' : undefined}
      >
        {created ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <DialogTitle>Endpoint created</DialogTitle>
              <DialogDescription>
                Relay will POST matching events to{' '}
                <span className="break-all font-mono">{created.url}</span>.
              </DialogDescription>
            </div>
            <SigningSecretReveal
              secret={created.signingSecret}
              acknowledged={acknowledged}
              onAcknowledgedChange={setAcknowledged}
            />
            <DialogFooter>
              <Button disabled={!acknowledged} onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <DialogTitle>{endpoint ? 'Edit endpoint' : 'Add endpoint'}</DialogTitle>
              <DialogDescription>
                {environmentKind === 'production'
                  ? 'Production endpoints must use https and be reachable on the public internet.'
                  : 'In development you can also use http and localhost receivers.'}
              </DialogDescription>
            </div>

            {unmappedError && <ErrorAlert>{mutation.error.message}</ErrorAlert>}

            <div className="flex flex-col gap-2">
              <Label htmlFor="endpoint-url">URL</Label>
              <Input
                id="endpoint-url"
                type="url"
                inputMode="url"
                placeholder="https://example.com/webhooks"
                autoFocus
                className="font-mono"
                aria-invalid={errors.url ? true : undefined}
                aria-describedby={errors.url ? 'endpoint-url-error' : undefined}
                {...form.register('url')}
              />
              {fieldError('endpoint-url', errors.url?.message)}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="endpoint-description">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="endpoint-description"
                placeholder="e.g. Billing service"
                aria-invalid={errors.description ? true : undefined}
                {...form.register('description')}
              />
              {fieldError('endpoint-description', errors.description?.message)}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="endpoint-types">
                Event types <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="endpoint-types"
                placeholder="invoice.paid, customer.created"
                className="font-mono"
                aria-invalid={errors.eventTypes ? true : undefined}
                aria-describedby={
                  errors.eventTypes ? 'endpoint-types-error' : 'endpoint-types-hint'
                }
                {...form.register('eventTypes')}
              />
              {fieldError(
                'endpoint-types',
                errors.eventTypes?.message,
                'Separate with commas. Leave empty to receive every event type.',
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                {endpoint
                  ? isSubmitting
                    ? 'Saving…'
                    : 'Save changes'
                  : isSubmitting
                    ? 'Adding…'
                    : 'Add endpoint'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
