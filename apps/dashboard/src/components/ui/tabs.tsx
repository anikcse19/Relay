'use client';

import { Tabs as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = Primitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
  return <Primitive.List className={cn('flex gap-1 border-b', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={cn(
        '-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content className={cn('pt-3 outline-none', className)} {...props} />;
}
