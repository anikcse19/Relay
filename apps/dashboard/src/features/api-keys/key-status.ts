import type { ApiKey } from '@/lib/types';

export type KeyStatus = 'active' | 'revoked' | 'expired';

/** Mirrors the API's auth rule: revoked wins, then expiry, else active. */
export function keyStatus(key: ApiKey, now: Date = new Date()): KeyStatus {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && new Date(key.expiresAt) <= now) return 'expired';
  return 'active';
}
