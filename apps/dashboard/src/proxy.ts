import { type NextRequest, NextResponse } from 'next/server';

/**
 * Same-origin API (ADR-0010): the browser only talks to the dashboard's own
 * origin; `/auth/*` and `/v1/*` are forwarded to the Relay API. Session
 * cookies therefore stay first-party (dev and production alike) and the
 * browser needs no CORS.
 *
 * Done here rather than in `next.config.ts` rewrites on purpose: config
 * rewrites are evaluated at BUILD time and baked into the build output, so
 * one build could not be pointed at a different API. This runs per request
 * and reads `API_URL` at runtime.
 */
export function proxy(request: NextRequest) {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
  const { pathname, search } = request.nextUrl;
  return NextResponse.rewrite(new URL(`${pathname}${search}`, apiUrl));
}

export const config = {
  matcher: ['/auth/:path*', '/v1/:path*'],
};
