import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DatabaseHandle } from '@relay/db';
import { createApp } from '../src/app.js';
import { type Env, parseEnv } from '../src/config/env.js';

export const testEnv = parseEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://unused@localhost/relay',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  // `fastify.inject` requests arrive with Host: localhost:80.
  BETTER_AUTH_URL: 'http://localhost',
  DASHBOARD_URL: 'http://localhost:3001',
});

/** The trusted dashboard origin. */
export const ORIGIN = testEnv.DASHBOARD_URL;

export async function boot(
  database: DatabaseHandle,
  overrides: Partial<Env> = {},
): Promise<NestFastifyApplication> {
  const app = await createApp({ env: { ...testEnv, ...overrides }, database });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** `name=value` pairs from Set-Cookie, ready to send back as a Cookie header. */
export function cookieHeader(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.split(';')[0])
    .join('; ');
}

export interface TestUser {
  userId: string;
  cookie: string;
  organizationId: string;
  developmentEnvId: string;
  productionEnvId: string;
}

/** Signs up a user and returns their session cookie and provisioned workspace. */
export async function signUpUser(app: NestFastifyApplication, email: string): Promise<TestUser> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/sign-up/email',
    headers: { origin: ORIGIN },
    payload: { email, name: email.split('@')[0], password: 'correct-horse-battery' },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const cookie = cookieHeader(res);

  const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).json();
  const org = me.organizations[0];
  const envId = (kind: string) =>
    org.environments.find((e: { kind: string }) => e.kind === kind).id;

  return {
    userId: me.user.id,
    cookie,
    organizationId: org.id,
    developmentEnvId: envId('development'),
    productionEnvId: envId('production'),
  };
}
