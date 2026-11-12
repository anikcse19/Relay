import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { defaultUrlPolicy, isPublicAddress, type UrlPolicy } from '@relay/shared';
import type { Env } from '../config/env.js';

export { isPublicAddress, type UrlPolicy };

export function urlPolicyFor(env: Pick<Env, 'NODE_ENV' | 'ENDPOINT_URL_POLICY'>): UrlPolicy {
  return defaultUrlPolicy(env.NODE_ENV, env.ENDPOINT_URL_POLICY);
}

/** Resolves a hostname to every address it points at. Injectable for tests. */
export type Resolver = (hostname: string) => Promise<string[]>;

export const systemResolver: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

export class EndpointUrlError extends Error {
  override name = 'EndpointUrlError';
}

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

/**
 * Validates and normalises an endpoint URL at registration time.
 *
 * This is the *basic* SSRF guard: it stops obviously internal targets and
 * gives the user a clear error up front. It cannot stop DNS rebinding (a
 * hostname that resolves publicly now and privately later), so the worker
 * also checks the address it actually connects to (ADR-0012).
 *
 * Returns the normalised URL (lower-case host, no fragment).
 */
export async function checkEndpointUrl(
  input: string,
  policy: UrlPolicy,
  resolve: Resolver = systemResolver,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new EndpointUrlError('Enter a full URL, e.g. https://example.com/webhooks.');
  }

  const allowed = policy === 'strict' ? ['https:'] : ['https:', 'http:'];
  if (!allowed.includes(url.protocol)) {
    throw new EndpointUrlError(
      policy === 'strict' ? 'The URL must use https.' : 'The URL must use http or https.',
    );
  }
  if (url.username || url.password) {
    throw new EndpointUrlError(
      'The URL must not contain credentials. Use a custom header to authenticate instead.',
    );
  }
  url.hash = '';

  if (policy === 'permissive') return url.href;

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw privateTarget();
    return url.href;
  }
  if (
    hostname === 'localhost' ||
    !hostname.includes('.') ||
    INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw privateTarget();
  }

  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    addresses = [];
  }
  if (addresses.length === 0) {
    throw new EndpointUrlError(`The hostname ${hostname} could not be resolved.`);
  }
  // Every address must be public: a mixed answer is a classic rebinding setup.
  if (!addresses.every(isPublicAddress)) throw privateTarget();
  return url.href;
}

function privateTarget(): EndpointUrlError {
  return new EndpointUrlError(
    'The URL points to a private or internal address. Endpoints must be reachable on the public internet.',
  );
}
