import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Environment contract for the API. Parsed once at startup: if anything is
 * missing or malformed the process refuses to start and says exactly why
 * ("fail fast"), instead of crashing later on the first request.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),
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
