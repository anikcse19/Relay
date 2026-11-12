import { createHash, randomBytes } from 'node:crypto';

/**
 * API key format: `rk_<mode>_<secret>`
 *
 *  - `mode` is `test` (development environments) or `live` (production), so a
 *    key's blast radius is obvious at a glance, as with Stripe keys.
 *  - `secret` is 43 base62 characters (~256 bits). Base62 has no `-`/`_`, so
 *    double-clicking selects the whole key, and the fixed shape is easy for
 *    secret scanners (e.g. GitHub push protection) to match.
 *
 * Only a SHA-256 hash is stored. Keys are high-entropy random strings, so a
 * fast hash is safe here (a slow KDF only matters for guessable inputs like
 * passwords), and it keeps per-request authentication cheap.
 */
export type KeyMode = 'test' | 'live';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SECRET_LENGTH = 43;
/** Characters of the secret kept (non-secret) for display: `rk_live_a1B2c3…`. */
const DISPLAY_CHARS = 6;

export const API_KEY_PATTERN = /^rk_(test|live)_[0-9A-Za-z]{43}$/;

function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // Rejection sampling: 248 = 62 * 4, so `byte % 62` stays unbiased.
      if (byte < 248) out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export function modeForEnvironment(kind: 'development' | 'production'): KeyMode {
  return kind === 'production' ? 'live' : 'test';
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export interface GeneratedKey {
  /** The full key: return it to the user once, never store it. */
  key: string;
  keyPrefix: string;
  keyHash: string;
}

export function generateApiKey(mode: KeyMode): GeneratedKey {
  const key = `rk_${mode}_${randomBase62(SECRET_LENGTH)}`;
  return {
    key,
    keyPrefix: key.slice(0, `rk_${mode}_`.length + DISPLAY_CHARS),
    keyHash: hashApiKey(key),
  };
}

/** Extracts a well-formed key from an `Authorization: Bearer …` header. */
export function parseBearerKey(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  const key = match?.[1];
  return key && API_KEY_PATTERN.test(key) ? key : undefined;
}
