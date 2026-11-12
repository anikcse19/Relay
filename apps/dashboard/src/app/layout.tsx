import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Relay', template: '%s · Relay' },
  description: 'Reliable webhook delivery: send one event, Relay delivers it everywhere.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the class before hydration; suppress the expected mismatch.
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
