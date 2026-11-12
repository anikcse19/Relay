'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { QueryProvider } from './query-provider';

export function Providers({ children }: { children: ReactNode }) {
  // Dark is the default for a developer tool (guidelines §2.1); users can switch.
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryProvider>{children}</QueryProvider>
    </ThemeProvider>
  );
}
