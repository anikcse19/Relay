import { randomBytes } from 'node:crypto';

/**
 * Prefixed, time-sortable identifiers (e.g. `evt_01JD3X...`).
 *
 * The prefix makes IDs self-describing in logs, support tickets and the UI
 * (a pattern popularised by Stripe). The body is a ULID: 48-bit millisecond
 * timestamp + 80 bits of randomness, Crockford base32 encoded, so IDs sort
 * lexicographically by creation time — which keeps B-tree inserts append-only
 * and makes cursor pagination trivial.
 */
export const ID_PREFIXES = {
  organization: 'org',
  environment: 'env',
  user: 'usr',
  membership: 'mem',
  apiKey: 'key',
  endpoint: 'ep',
  eventType: 'et',
  event: 'evt',
  delivery: 'dlv',
  attempt: 'att',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdKind];

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > 2 ** 48 - 1) {
    throw new RangeError(`Invalid ULID timestamp: ${ms}`);
  }
  let out = '';
  let value = ms;
  for (let i = 0; i < TIME_LEN; i++) {
    out = ENCODING[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(): string {
  // 16 chars * 5 bits = 80 bits. Use 16 random bytes and take 5 bits from each.
  const bytes = randomBytes(RANDOM_LEN);
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ENCODING[bytes[i]! & 31];
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export function newId(kind: IdKind, now?: number): string {
  return `${ID_PREFIXES[kind]}_${ulid(now)}`;
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isId(value: string, kind: IdKind): boolean {
  const prefix = `${ID_PREFIXES[kind]}_`;
  return value.startsWith(prefix) && ULID_RE.test(value.slice(prefix.length));
}

/** Extracts the creation time embedded in a prefixed ID. */
export function idTimestamp(id: string): Date {
  const body = id.slice(id.indexOf('_') + 1, id.indexOf('_') + 1 + TIME_LEN);
  let ms = 0;
  for (const ch of body) {
    const v = ENCODING.indexOf(ch);
    if (v === -1) throw new Error(`Invalid id: ${id}`);
    ms = ms * 32 + v;
  }
  return new Date(ms);
}
