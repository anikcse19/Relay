import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Worker environment contract. Parsed once at startup; invalid config refuses to start. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),
  /** Deliveries in flight per worker process. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(10),
  /** Per-attempt HTTP timeout, covering connect + response body. */
  DELIVERY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function parseEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Loads the repo-root `.env` for local development (production injects real env vars). */
export function loadDotEnv(cwd: string = process.cwd()): void {
  for (const candidate of [resolve(cwd, '.env'), resolve(cwd, '../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}
