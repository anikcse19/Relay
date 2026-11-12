import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DatabaseHandle } from '@relay/db';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

export const testEnv = parseEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://unused@localhost/relay',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  // `fastify.inject` requests arrive with Host: localhost:80.
  BETTER_AUTH_URL: 'http://localhost',
  DASHBOARD_URL: 'http://localhost:3001',
});

export async function boot(database: DatabaseHandle): Promise<NestFastifyApplication> {
  const app = await createApp({ env: testEnv, database });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
