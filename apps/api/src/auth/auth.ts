import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { type Database, schema } from '@relay/db';
import { type IdKind, newId } from '@relay/shared';
import type { Env } from '../config/env.js';
import { ensureDefaultOrganization } from './provisioning.js';

/** All Better Auth endpoints live under this path (e.g. `POST /auth/sign-up/email`). */
export const AUTH_BASE_PATH = '/auth';

/** Better Auth model name → our prefixed-ID kind (see `ID_PREFIXES`). */
const ID_KIND_BY_MODEL: Record<string, IdKind> = {
  user: 'user',
  session: 'session',
  account: 'account',
  verification: 'verification',
  organization: 'organization',
  member: 'membership',
  invitation: 'invitation',
};

export function createAuth(env: Env, db: Database) {
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined;

  return betterAuth({
    appName: 'Relay',
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.DASHBOARD_URL],
    telemetry: { enabled: false },

    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // No transactional email provider yet; verification arrives with the dashboard.
      requireEmailVerification: false,
    },
    socialProviders: github ? { github } : {},

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // slide expiry at most once a day (saves writes)
    },

    plugins: [organization()],

    advanced: {
      cookiePrefix: 'relay',
      // Better Auth silently disables origin/CSRF checks when it detects a test
      // runner. Pin them on so tests exercise exactly what production runs.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: {
        generateId: ({ model }) => {
          const kind = ID_KIND_BY_MODEL[model];
          // Fail loudly: a new plugin model must get an explicit prefix.
          if (!kind) throw new Error(`No ID prefix registered for auth model "${model}"`);
          return newId(kind);
        },
      },
    },

    databaseHooks: {
      user: {
        create: {
          // Every account gets a workspace immediately: an organization with
          // Development + Production environments, owned by the new user.
          after: async (user) => {
            await ensureDefaultOrganization(db, user.id);
          },
        },
      },
      session: {
        create: {
          // Scope new sessions to the user's organization (and self-heal a
          // user left without one, e.g. if the sign-up hook crashed).
          before: async (session) => ({
            data: {
              ...session,
              activeOrganizationId: await ensureDefaultOrganization(db, session.userId),
            },
          }),
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
