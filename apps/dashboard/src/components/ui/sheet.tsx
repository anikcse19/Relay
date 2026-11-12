'use client';

import { X } from 'lucide-react';
import { Dialog as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Right-side drawer for master–detail (guidelines §3.4): keeps the list and
 * its scroll position behind it. Full-screen below `sm` (§9).
 */
export const Sheet = Primitive.Root;

export function SheetContent({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <Primitive.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto border-l bg-popover shadow-xl sm:max-w-2xl',
          className,
        )}
        {...props}
      >
        {children}
        <Primitive.Close
          className="absolute right-4 top-4 rounded-sm text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" aria-hidden />
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export const SheetTitle = Primitive.Title;
export const SheetDescription = Primitive.Description;
