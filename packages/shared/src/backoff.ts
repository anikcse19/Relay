/**
 * Retry scheduling for webhook deliveries.
 *
 * Exponential backoff with "full jitter" (AWS Architecture Blog, 2015):
 *   delay = random(0, min(cap, base * 2^attempt))
 *
 * Jitter spreads retries out so that when a popular customer endpoint recovers
 * from an outage it is not hit by a synchronized thundering herd of retries.
 */
export interface BackoffPolicy {
  /** Delay ceiling for the first retry, in ms. */
  baseMs: number;
  /** Maximum delay for any single retry, in ms. */
  capMs: number;
  /** Total attempts including the first one. After this the delivery is dead-lettered. */
  maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 5_000,
  capMs: 6 * 60 * 60 * 1000, // 6 hours
  maxAttempts: 8, // ~ spans roughly a day in the worst case
};

/**
 * Returns the delay before the next attempt, or `null` if the delivery
 * should be dead-lettered.
 *
 * @param attemptsMade attempts already performed (>= 1)
 * @param random injectable RNG for deterministic tests
 */
export function nextRetryDelay(
  attemptsMade: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number | null {
  if (attemptsMade >= policy.maxAttempts) return null;
  const exp = Math.min(policy.capMs, policy.baseMs * 2 ** (attemptsMade - 1));
  return Math.floor(random() * exp);
}

/**
 * Some HTTP outcomes should never be retried: the receiver has told us the
 * request itself is wrong, so retrying would just repeat the failure.
 * 408 (timeout) and 429 (rate limited) are retryable despite being 4xx.
 */
export function isRetryableStatus(status: number): boolean {
  if (status >= 200 && status < 300) return false;
  if (status === 408 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}
