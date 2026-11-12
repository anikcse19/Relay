import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signing compatible with the Standard Webhooks spec
 * (https://www.standardwebhooks.com/).
 *
 * Headers sent with every delivery:
 *   webhook-id:        unique message id (receivers use it for idempotency)
 *   webhook-timestamp: unix seconds (receivers reject stale messages → replay protection)
 *   webhook-signature: space-separated list of `v1,<base64 HMAC-SHA256>`
 *                      (multiple signatures allow zero-downtime secret rotation)
 *
 * Signed content: `${id}.${timestamp}.${body}`
 */

const SECRET_PREFIX = 'whsec_';
export const DEFAULT_TOLERANCE_SECONDS = 5 * 60;
/**
 * After an endpoint's secret is rotated, deliveries are signed with both the
 * new and the previous secret for this long, so receivers can switch over
 * without dropping a single webhook.
 */
export const SECRET_ROTATION_GRACE_HOURS = 24;

export interface SignatureHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

/**
 * The JSON body POSTed to endpoints (Standard Webhooks shape). One function,
 * used by the worker to send and by the API to show it, so the inspector
 * always displays the exact bytes that were signed.
 */
export function webhookBody(event: { type: string; createdAt: Date; data: unknown }): string {
  return JSON.stringify({
    type: event.type,
    timestamp: event.createdAt.toISOString(),
    data: event.data,
  });
}

export function generateSigningSecret(): string {
  return SECRET_PREFIX + randomBytes(24).toString('base64');
}

function secretBytes(secret: string): Buffer {
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  return Buffer.from(raw, 'base64');
}

function computeSignature(secret: string, msgId: string, timestamp: number, body: string): string {
  return createHmac('sha256', secretBytes(secret))
    .update(`${msgId}.${timestamp}.${body}`)
    .digest('base64');
}

/**
 * Signs a payload. Pass several secrets during rotation; each produces one
 * `v1,` entry so receivers holding either the old or new secret can verify.
 */
export function sign(
  secrets: string | readonly string[],
  msgId: string,
  body: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): SignatureHeaders {
  const list = typeof secrets === 'string' ? [secrets] : secrets;
  if (list.length === 0) throw new Error('At least one signing secret is required');
  const signature = list.map((s) => `v1,${computeSignature(s, msgId, timestamp, body)}`).join(' ');
  return {
    'webhook-id': msgId,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': signature,
  };
}

export class WebhookVerificationError extends Error {
  override name = 'WebhookVerificationError';
}

/** Verifies an incoming webhook. Throws `WebhookVerificationError` on failure. */
export function verify(
  secret: string,
  headers: SignatureHeaders,
  body: string,
  options: { toleranceSeconds?: number; now?: number } = {},
): void {
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const timestamp = Number(headers['webhook-timestamp']);

  if (!Number.isInteger(timestamp)) {
    throw new WebhookVerificationError('Invalid timestamp header');
  }
  if (Math.abs(now - timestamp) > tolerance) {
    throw new WebhookVerificationError('Timestamp outside tolerance window');
  }

  const expected = Buffer.from(computeSignature(secret, headers['webhook-id'], timestamp, body));
  const match = headers['webhook-signature'].split(' ').some((entry) => {
    const [version, sig] = entry.split(',', 2);
    if (version !== 'v1' || !sig) return false;
    const candidate = Buffer.from(sig);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });

  if (!match) throw new WebhookVerificationError('No matching signature');
}
