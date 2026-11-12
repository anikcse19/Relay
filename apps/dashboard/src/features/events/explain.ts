import type { DeliveryAttempt, DeliveryStatus } from '@/lib/types';

export interface Explanation {
  /** One line: what happened. */
  title: string;
  /** What to do about it. */
  detail: string;
  /** Whether Relay retries after this outcome (mirrors `isRetryableStatus`). */
  retried: boolean;
}

/** Short label for an attempt's outcome in the timeline: "200", "503", "Timeout". */
export function attemptLabel(attempt: Pick<DeliveryAttempt, 'statusCode' | 'errorCode'>): string {
  if (attempt.statusCode !== null) return String(attempt.statusCode);
  return ERROR_LABELS[attempt.errorCode ?? ''] ?? 'Error';
}

export function attemptSucceeded(attempt: Pick<DeliveryAttempt, 'statusCode'>): boolean {
  return attempt.statusCode !== null && attempt.statusCode >= 200 && attempt.statusCode < 300;
}

const ERROR_LABELS: Record<string, string> = {
  timeout: 'Timeout',
  dns: 'DNS error',
  connection_refused: 'Refused',
  connection_reset: 'Reset',
  tls: 'TLS error',
  network: 'Network error',
  blocked_port: 'Blocked port',
  blocked_address: 'Blocked address',
};

/**
 * Plain-English explanation of a failed attempt (guidelines §4.3): what
 * happened and what to do, never just an error code. `null` for successes.
 */
export function explainAttempt(
  attempt: Pick<DeliveryAttempt, 'statusCode' | 'errorCode'>,
): Explanation | null {
  if (attemptSucceeded(attempt)) return null;
  const status = attempt.statusCode;

  if (status !== null) {
    if (status >= 300 && status < 400) {
      return {
        title: `Your server answered with a redirect (${status})`,
        detail:
          'Relay never follows redirects: the signed payload may only go to the URL you registered. ' +
          'Update the endpoint URL to the final address (often http → https or a missing trailing slash).',
        retried: true,
      };
    }
    if (status === 401 || status === 403) {
      return {
        title: `Your server rejected the webhook (${status})`,
        detail:
          'Usually a failed signature check or auth middleware in front of the route. Verify with ' +
          "this endpoint's current signing secret, over the raw request body (before JSON parsing). " +
          'Relay does not retry 4xx responses.',
        retried: false,
      };
    }
    if (status === 404 || status === 405) {
      return {
        title: `Your server has no handler at this URL (${status})`,
        detail:
          'Check the path in the endpoint URL and that the route accepts POST. Relay does not retry 4xx responses.',
        retried: false,
      };
    }
    if (status === 408 || status === 429) {
      return {
        title:
          status === 429
            ? 'Your server is rate limiting Relay (429)'
            : 'Your server timed out reading the request (408)',
        detail:
          'Relay will retry with backoff and honours a Retry-After header. If this persists, raise the limit for Relay.',
        retried: true,
      };
    }
    if (status >= 400 && status < 500) {
      return {
        title: `Your server rejected the webhook (${status})`,
        detail:
          'A 4xx means the request itself was refused, so Relay does not retry it. Check the response body ' +
          'for the reason. Fix your handler, then replay the delivery.',
        retried: false,
      };
    }
    return {
      title: `Your server returned an error (${status})`,
      detail:
        'Check your server logs around this time. Relay retries automatically with backoff, so a ' +
        'temporary outage heals itself.',
      retried: true,
    };
  }

  switch (attempt.errorCode) {
    case 'timeout':
      return {
        title: "Your server didn't respond in time",
        detail:
          'Relay waits a limited time for the full response (15 s by default). Return 2xx quickly and do slow work ' +
          'in the background (e.g. a job queue). Relay will retry.',
        retried: true,
      };
    case 'dns':
      return {
        title: "The hostname couldn't be resolved",
        detail:
          'Check the endpoint URL for typos and that its DNS record exists. Relay will retry.',
        retried: true,
      };
    case 'connection_refused':
      return {
        title: 'Nothing is accepting connections at this address',
        detail:
          'The server refused the connection. Check that it is running and listening on the port in the URL. Relay will retry.',
        retried: true,
      };
    case 'connection_reset':
      return {
        title: 'The connection was dropped before a response',
        detail:
          'Often a crash in the handler, or a proxy or load balancer closing the connection. Relay will retry.',
        retried: true,
      };
    case 'tls':
      return {
        title: 'The https (TLS) handshake failed',
        detail:
          'The certificate may be expired, self-signed, or issued for a different hostname. Relay will retry.',
        retried: true,
      };
    case 'blocked_port':
      return {
        title: "This port can't receive webhooks",
        detail:
          'Relay never connects to ports reserved for other protocols (e.g. 25 for email). Use 443 or another ' +
          'standard web port. This is not retried.',
        retried: false,
      };
    case 'blocked_address':
      return {
        title: 'Relay refused to connect to a private address',
        detail:
          "The endpoint's hostname resolved to a private, loopback or internal address when Relay " +
          'connected. Webhooks only go to the public internet, so this is not retried. Point the ' +
          'hostname at a public server, then replay.',
        retried: false,
      };
    default:
      return {
        title: 'A network error occurred',
        detail: 'Relay could not complete the request. It will retry.',
        retried: true,
      };
  }
}

/** One-line summary for the inspector header. */
export function deliverySummary(status: DeliveryStatus, attempts: number): string {
  const tries = `${attempts} attempt${attempts === 1 ? '' : 's'}`;
  switch (status) {
    case 'succeeded':
      return attempts <= 1 ? 'Delivered on the first attempt' : `Delivered after ${tries}`;
    case 'failed':
      return `Failed after ${tries}; no more retries`;
    case 'retrying':
      return `${tries} so far; retrying`;
    case 'cancelled':
      return 'Cancelled: the endpoint was disabled';
    case 'pending':
      return attempts === 0 ? 'Queued; not attempted yet' : `${tries} so far; next attempt queued`;
    default:
      return attempts === 0 ? 'Queued; not attempted yet' : tries;
  }
}

/** "+6s", "+2m 4s", "+1h 5m": the gap between attempts, so backoff is visible. */
export function formatDelta(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `+${m}m${s % 60 ? ` ${s % 60}s` : ''}`;
  const h = Math.floor(m / 60);
  return `+${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

/** "212 ms", "1.2 s", "15.0 s". */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Pretty-prints JSON for display; returns the input unchanged if it isn't JSON. */
export function prettyJson(text: string | null): string {
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
