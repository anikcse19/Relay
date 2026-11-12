'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type FieldPath, useForm } from 'react-hook-form';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { type AuthValues, MIN_PASSWORD_LENGTH, signInSchema, signUpSchema } from './schemas';

type Mode = 'sign-in' | 'sign-up';

const COPY = {
  'sign-in': { submit: 'Sign in', pending: 'Signing in…' },
  'sign-up': { submit: 'Create account', pending: 'Creating account…' },
} as const;

/** Friendlier text for Better Auth error codes; falls back to the server's message. */
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Incorrect email or password.',
  USER_ALREADY_EXISTS: 'An account with this email already exists. Sign in instead?',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'An account with this email already exists. Sign in instead?',
  PASSWORD_TOO_SHORT: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const isSignUp = mode === 'sign-up';

  const form = useForm<AuthValues>({
    resolver: zodResolver(isSignUp ? signUpSchema : signInSchema),
    mode: 'onBlur', // inline validation on blur (guidelines §6)
    defaultValues: { name: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: AuthValues) {
    setFormError(null);
    const { error } = isSignUp
      ? await authClient.signUp.email({ ...values, name: values.name ?? '' })
      : await authClient.signIn.email({ email: values.email, password: values.password });

    if (error) {
      setFormError(
        (error.code && ERROR_MESSAGES[error.code]) ??
          error.message ??
          'Something went wrong. Please try again.',
      );
      return;
    }
    router.replace('/');
    router.refresh();
  }

  const field = (name: FieldPath<AuthValues>) => ({
    id: name,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
    ...form.register(name),
  });

  const fieldError = (name: FieldPath<AuthValues>) =>
    errors[name] && (
      <p id={`${name}-error`} className="text-xs text-danger">
        {errors[name]?.message}
      </p>
    );

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      {formError && <ErrorAlert>{formError}</ErrorAlert>}

      {isSignUp && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input autoComplete="name" autoFocus {...field('name')} />
          {fieldError('name')}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input type="email" autoComplete="email" autoFocus={!isSignUp} {...field('email')} />
        {fieldError('email')}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          type="password"
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          {...field('password')}
        />
        {fieldError('password') ??
          (isSignUp && (
            <p className="text-xs text-muted-foreground">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          ))}
      </div>

      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        {isSubmitting ? COPY[mode].pending : COPY[mode].submit}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {isSignUp ? 'Already have an account? ' : 'New to Relay? '}
        <Link href={isSignUp ? '/sign-in' : '/sign-up'} className="text-primary hover:underline">
          {isSignUp ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </form>
  );
}
