/** Same rule as the API's `EVENT_TYPE_PATTERN`. */
const EVENT_TYPE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

/**
 * "invoice.paid, user.created" → `['invoice.paid', 'user.created']`.
 * Blank → `null` (receive every event type). Separators: commas, spaces, newlines.
 */
export function parseEventTypes(input: string): string[] | null {
  const types = input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  return types.length === 0 ? null : [...new Set(types)];
}

/** The first entry that isn't a valid event type, if any. */
export function invalidEventType(input: string): string | undefined {
  return parseEventTypes(input)?.find((t) => t.length > 100 || !EVENT_TYPE.test(t));
}

/** A short, human label for an endpoint's subscription. */
export function describeFilter(types: string[] | null): string {
  if (!types) return 'All event types';
  if (types.length <= 2) return types.join(', ');
  return `${types.slice(0, 2).join(', ')} +${types.length - 2} more`;
}

/** Copy-pasteable verification snippet for the receiver (Standard Webhooks). */
export function verifySnippet(secret: string): string {
  return [
    "import { Webhook } from 'standardwebhooks';",
    '',
    `const wh = new Webhook('${secret}');`,
    '// Throws if the signature or timestamp is invalid.',
    'const event = wh.verify(rawBody, {',
    "  'webhook-id': req.headers['webhook-id'],",
    "  'webhook-timestamp': req.headers['webhook-timestamp'],",
    "  'webhook-signature': req.headers['webhook-signature'],",
    '});',
  ].join('\n');
}
