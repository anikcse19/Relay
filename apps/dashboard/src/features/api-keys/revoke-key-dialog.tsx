'use client';

import { useState } from 'react';
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
import type { ApiKey } from '@/lib/types';

/**
 * Irreversible → explicit confirmation stating the consequence (guidelines
 * §6). In production the user must also type the key's name (§3.2).
 */
export function RevokeKeyDialog({
  apiKey,
  production,
  onConfirm,
  onClose,
}: {
  apiKey: ApiKey | null;
  production: boolean;
  onConfirm: (key: ApiKey) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const confirmed = !production || typed === apiKey?.name;

  return (
    <Dialog
      open={apiKey !== null}
      onOpenChange={(open) => {
        if (!open) {
          setTyped('');
          onClose();
        }
      }}
    >
      <DialogContent>
        {apiKey && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!confirmed) return;
              setTyped('');
              onConfirm(apiKey);
            }}
          >
            <div className="flex flex-col gap-1">
              <DialogTitle>Revoke “{apiKey.name}”?</DialogTitle>
              <DialogDescription>
                Requests using <span className="font-mono">{apiKey.keyPrefix}…</span> will be
                rejected with 401 immediately. This can&apos;t be undone; you&apos;ll need to create
                a new key and deploy it.
              </DialogDescription>
            </div>

            {production && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-name">
                  This is a <strong>production</strong> key. Type{' '}
                  <span className="font-mono">{apiKey.name}</span> to confirm.
                </Label>
                <Input
                  id="confirm-name"
                  autoComplete="off"
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={!confirmed}>
                Revoke key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
