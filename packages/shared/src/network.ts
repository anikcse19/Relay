import { BlockList, isIP } from 'node:net';

/**
 * Network policy shared by the API (endpoint registration) and the worker
 * (connect time), so both enforce exactly the same notion of "public".
 *
 * `strict`: https only, public addresses only (the production default).
 * `permissive`: also http and private/loopback addresses, so local receivers
 * work in development and tests.
 */
export type UrlPolicy = 'strict' | 'permissive';

export function defaultUrlPolicy(nodeEnv: string, override?: UrlPolicy): UrlPolicy {
  return override ?? (nodeEnv === 'production' ? 'strict' : 'permissive');
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
