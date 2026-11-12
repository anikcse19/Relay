import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { Env } from '../config/env.js';

export type UrlPolicy = 'strict' | 'permissive';

export function urlPolicyFor(env: Pick<Env, 'NODE_ENV' | 'ENDPOINT_URL_POLICY'>): UrlPolicy {
  return env.ENDPOINT_URL_POLICY ?? (env.NODE_ENV === 'production' ? 'strict' : 'permissive');
}

/** Resolves a hostname to every address it points at. Injectable for tests. */
export type Resolver = (hostname: string) => Promise<string[]>;

export const systemResolver: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

export class EndpointUrlError extends Error {
  override name = 'EndpointUrlError';
}

/**
 * Addresses a webhook must never be sent to: loopback, private networks,
 * link-local (incl. the cloud metadata service at 169.254.169.254),
 * carrier-grade NAT, multicast, reserved and documentation ranges, and
 * IPv6 forms that can embed an IPv4 address (NAT64, 6to4).
 */
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  // No rule for IPv4-mapped (::ffff:0:0/96): BlockList already checks those
  // against the IPv4 rules above, and such a rule would also match every
  // plain IPv4 address.
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !NON_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

/**
 * Validates and normalises an endpoint URL at registration time.
 *
 * This is the *basic* SSRF guard: it stops obviously internal targets and
 * gives the user a clear error up front. It cannot stop DNS rebinding (a
 * hostname that resolves publicly now and privately later), so the worker
 * will also check the address it actually connects to (Phase 2, ADR-0011).
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
