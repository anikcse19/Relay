import type { Metadata } from 'next';
import { AuthForm } from '@/features/auth/auth-form';

export const metadata: Metadata = { title: 'Create account' };

export default function SignUpPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        You&apos;ll get a workspace with Development and Production environments.
      </p>
      <AuthForm mode="sign-up" />
    </>
  );
}
