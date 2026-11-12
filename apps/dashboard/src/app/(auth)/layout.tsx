import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { getMe } from '@/lib/api.server';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  // Already signed in? Skip the form.
  if (await getMe()) redirect('/');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <Logo className="text-lg" />
      <div className="w-full max-w-sm rounded-lg border bg-card p-6">{children}</div>
    </main>
  );
}
