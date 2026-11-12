'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
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
import type { Endpoint, EndpointWithSecret } from '@/lib/types';
import { useDeleteEndpoint, useRotateSecret } from './api';
import { SigningSecretReveal } from './signing-secret-reveal';

/** Confirm → new secret shown once. Locked until the user saves it. */
export function RotateSecretDialog({
  environmentId,
  endpoint,
  onClose,
}: {
  environmentId: string;
  endpoint: Endpoint | null;
  onClose: () => void;
}) {
  const rotate = useRotateSecret(environmentId);
  const [rotated, setRotated] = useState<EndpointWithSecret | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const locked = rotated !== null && !acknowledged;

  function close() {
    setRotated(null);
    setAcknowledged(false);
    rotate.reset();
    onClose();
  }

  return (
    <Dialog open={endpoint !== null} onOpenChange={(open) => !open && !locked && close()}>
      <DialogContent
        hideClose={locked}
        onEscapeKeyDown={(e) => locked && e.preventDefault()}
        onPointerDownOutside={(e) => locked && e.preventDefault()}
        className={rotated ? 'max-w-2xl' : undefined}
      >
        {endpoint && !rotated && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <DialogTitle>Rotate signing secret?</DialogTitle>
              <DialogDescription>
                Relay issues a new secret for{' '}
                <span className="break-all font-mono">{endpoint.url}</span>. For the next 24 hours
                every webhook is signed with <strong>both</strong> the old and the new secret, so
                you can deploy the new one without failing a single verification.
              </DialogDescription>
            </div>
            {rotate.error && <ErrorAlert>{rotate.error.message}</ErrorAlert>}
            <DialogFooter>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={rotate.isPending}
                onClick={async () => setRotated(await rotate.mutateAsync(endpoint.id))}
              >
                {rotate.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Rotate secret
              </Button>
            </DialogFooter>
          </div>
        )}
        {rotated && (
          <div className="flex flex-col gap-4">
            <DialogTitle>New signing secret</DialogTitle>
            <SigningSecretReveal
              secret={rotated.signingSecret}
              acknowledged={acknowledged}
              onAcknowledgedChange={setAcknowledged}
              note="The previous secret keeps working for 24 hours."
            />
            <DialogFooter>
              <Button disabled={!acknowledged} onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Irreversible → states the consequence; in production the user must also
 * type the endpoint's hostname (guidelines §3.2, §6).
 */
export function DeleteEndpointDialog({
  environmentId,
  endpoint,
  production,
  onClose,
}: {
  environmentId: string;
  endpoint: Endpoint | null;
  production: boolean;
  onClose: () => void;
}) {
  const remove = useDeleteEndpoint(environmentId);
  const [typed, setTyped] = useState('');
  const hostname = endpoint ? new URL(endpoint.url).hostname : '';
  const confirmed = !production || typed === hostname;

  function close() {
    setTyped('');
    remove.reset();
    onClose();
  }

  return (
    <Dialog open={endpoint !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        {endpoint && (
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!confirmed) return;
              await remove.mutateAsync(endpoint.id);
              close();
            }}
          >
            <div className="flex flex-col gap-1">
              <DialogTitle>Delete this endpoint?</DialogTitle>
              <DialogDescription>
                <span className="break-all font-mono">{endpoint.url}</span> stops receiving webhooks
                immediately. Its delivery history is deleted and pending deliveries are not sent.
                This can&apos;t be undone. To stop deliveries temporarily, pause it instead.
              </DialogDescription>
            </div>

            {production && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-host">
                  This is a <strong>production</strong> endpoint. Type{' '}
                  <span className="font-mono">{hostname}</span> to confirm.
                </Label>
                <Input
                  id="confirm-host"
                  autoComplete="off"
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
            )}

            {remove.error && <ErrorAlert>{remove.error.message}</ErrorAlert>}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={!confirmed || remove.isPending}>
                {remove.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Delete endpoint
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
