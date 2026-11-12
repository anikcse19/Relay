'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Talks to `/auth/*` on the dashboard's own origin, which Next.js rewrites to
 * the API (next.config.ts). Cookies are therefore first-party.
 */
export const authClient = createAuthClient({ basePath: '/auth' });
