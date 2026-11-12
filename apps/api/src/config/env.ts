import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Environment contract for the API. Parsed once at startup: if anything is
 * missing or malformed the process refuses to start and says exactly why
 * ("fail fast"), instead of crashing later on the first request.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),

    /** Signs session cookies and encrypts OAuth tokens. Generate: `openssl rand -base64 32`. */
    BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** Public base URL of this API; used to build OAuth callback URLs. */
    BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
    /** Dashboard origin, trusted for cookie-authenticated (CSRF-checked) requests. */
    DASHBOARD_URL: z.url().default('http://localhost:3001'),
    /** GitHub OAuth app credentials; the provider is enabled only when both are set. */
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    /**
     * Which endpoint URLs customers may register. `strict` (the production
     * default): https only, public addresses only. `permissive` (the default
     * elsewhere): also http and localhost, so local receivers work.
     */
    ENDPOINT_URL_POLICY: z.enum(['strict', 'permissive']).optional(),
  })
  .refine((env) => !!env.GITHUB_CLIENT_ID === !!env.GITHUB_CLIENT_SECRET, {
    message: 'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together',
    path: ['GITHUB_CLIENT_SECRET'],
  });

export type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * Loads the repo-root `.env` for local development. In production the
 * platform injects real environment variables and no file exists.
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  for (const candidate of [resolve(cwd, '.env'), resolve(cwd, '../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}
