import { describe, expect, it } from 'vitest';
import { curlSnippet, expiryToIso } from '@/features/api-keys/helpers';
import { keyStatus } from '@/features/api-keys/key-status';
import { formatRelative } from '@/lib/time';
import type { ApiKey } from '@/lib/types';

const base: ApiKey = {
  id: 'key_1',
  name: 'Billing',
  keyPrefix: 'rk_test_a1B2c3',
  environmentId: 'env_1',
  createdAt: '2026-11-01T00:00:00Z',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
};
const now = new Date('2026-11-12T12:00:00Z');

describe('keyStatus (mirrors the API auth rule)', () => {
  it('is active without revocation or expiry', () => {
    expect(keyStatus(base, now)).toBe('active');
    expect(keyStatus({ ...base, expiresAt: '2027-01-01T00:00:00Z' }, now)).toBe('active');
  });
  it('is expired once the expiry has passed', () => {
    expect(keyStatus({ ...base, expiresAt: '2026-11-12T11:59:59Z' }, now)).toBe('expired');
  });
  it('reports revoked even when also expired', () => {
    expect(
      keyStatus(
        { ...base, revokedAt: '2026-11-02T00:00:00Z', expiresAt: '2026-11-03T00:00:00Z' },
        now,
      ),
    ).toBe('revoked');
  });
});

describe('expiryToIso', () => {
  it('adds whole days', () => {
    expect(expiryToIso('30', now.getTime())).toBe('2026-12-12T12:00:00.000Z');
  });
  it('returns undefined for never-expiring keys', () => {
    expect(expiryToIso('never', now.getTime())).toBeUndefined();
  });
});

describe('curlSnippet', () => {
  it('produces a runnable command with the real key', () => {
    const snippet = curlSnippet('rk_test_secret');
    expect(snippet).toContain('/v1/events');
    expect(snippet).toContain('Authorization: Bearer rk_test_secret');
    expect(JSON.parse(snippet.match(/-d '(.*)'/)![1]!)).toMatchObject({ type: 'invoice.paid' });
  });
});

describe('formatRelative', () => {
  it.each([
    ['2026-11-12T11:59:30Z', 'just now'],
    ['2026-11-12T11:57:00Z', '3 minutes ago'],
    ['2026-11-12T10:00:00Z', '2 hours ago'],
    ['2026-11-11T12:00:00Z', 'yesterday'],
    ['2026-12-12T12:00:00Z', 'next month'],
    ['2026-11-15T12:00:00Z', 'in 3 days'],
  ])('%s → %s', (iso, expected) => {
    expect(formatRelative(new Date(iso), now)).toBe(expected);
  });
});
