import type { IncomingMessage } from 'node:http';
import { newId } from '@relay/shared';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept caller-supplied IDs (e.g. from a load balancer or the SDK) only if
// they are short and safe — they end up in logs, so reject anything that
// could be used for log injection.
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function genRequestId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  if (typeof incoming === 'string' && SAFE_ID.test(incoming)) return incoming;
  return newId('request');
}
