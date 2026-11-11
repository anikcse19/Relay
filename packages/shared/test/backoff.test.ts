import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKOFF, isRetryableStatus, nextRetryDelay } from '../src/backoff.js';

describe('nextRetryDelay', () => {
  const max = () => 0.999999;

  it('grows exponentially up to the cap', () => {
    const policy = { baseMs: 1000, capMs: 10_000, maxAttempts: 10 };
    expect(nextRetryDelay(1, policy, max)).toBe(999);
    expect(nextRetryDelay(2, policy, max)).toBe(1999);
    expect(nextRetryDelay(3, policy, max)).toBe(3999);
    expect(nextRetryDelay(6, policy, max)).toBe(9999); // capped
  });

  it('applies full jitter', () => {
    expect(nextRetryDelay(3, DEFAULT_BACKOFF, () => 0)).toBe(0);
  });

  it('returns null once attempts are exhausted', () => {
    expect(nextRetryDelay(DEFAULT_BACKOFF.maxAttempts)).toBeNull();
  });
});

describe('isRetryableStatus', () => {
  it.each([
    [200, false],
    [400, false],
    [404, false],
    [408, true],
    [429, true],
    [500, true],
    [503, true],
  ])('status %i → retryable=%s', (status, expected) => {
    expect(isRetryableStatus(status)).toBe(expected);
  });
});
