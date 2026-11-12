import type { Metadata } from 'next';
import { AuthForm } from '@/features/auth/auth-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-muted-foreground">Welcome back to Relay.</p>
      <AuthForm mode="sign-in" />
    </>
  );
}
