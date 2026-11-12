import { z } from 'zod';

/** Must match the API's Better Auth config (`minPasswordLength: 10`). */
export const MIN_PASSWORD_LENGTH = 10;

/** `name` is unused at sign-in; it's declared so both forms share one value shape. */
export const signInSchema = z.object({
  name: z.string().optional(),
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100),
  email: z.email('Enter a valid email address'),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(128),
});

/** Values of either form (sign-up's schema is the stricter of the two). */
export type AuthValues = z.input<typeof signInSchema>;
