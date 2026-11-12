import type { Endpoint } from '@/lib/types';

/**
 * What the Endpoints page says about an endpoint's health, most urgent
 * first. Structured (not a string) so times render with <RelativeTime>.
 */
export type HealthSummary =
  | { kind: 'circuit_open'; failures: number; until: string }
  | { kind: 'failing'; failures: number; since: string }
  | { kind: 'healthy'; lastSuccessAt: string }
  | { kind: 'no_deliveries' };

export function healthSummary(endpoint: Pick<Endpoint, 'status' | 'health'>): HealthSummary | null {
  // A disabled endpoint shows its reason instead; paused ones aren't being attempted.
  if (endpoint.status !== 'active') return null;
  const { consecutiveFailures, failingSince, circuitOpenUntil, lastSuccessAt } = endpoint.health;
  if (circuitOpenUntil)
    return { kind: 'circuit_open', failures: consecutiveFailures, until: circuitOpenUntil };
  if (consecutiveFailures > 0 && failingSince) {
    return { kind: 'failing', failures: consecutiveFailures, since: failingSince };
  }
  if (lastSuccessAt) return { kind: 'healthy', lastSuccessAt };
  return { kind: 'no_deliveries' };
}

export function failuresInARow(n: number): string {
  return n === 1 ? '1 failure' : `${n} failures in a row`;
}
