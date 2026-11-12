/**
 * Sends one webhook HTTP request and reports what happened, without throwing.
 * Every outcome, including network failures, becomes a `SendResult` that can
 * be stored as a delivery attempt and shown in the dashboard's inspector.
 */
import { type LookupAddress, lookup as dnsLookup } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { isPublicAddress, type UrlPolicy } from '@relay/shared';
import { Agent, type Dispatcher, fetch } from 'undici';

/** Matches `delivery_attempts.error_code`. */
export type DeliveryErrorCode =
  | 'timeout'
  | 'dns'
  | 'connection_refused'
  | 'connection_reset'
  | 'tls'
  | 'blocked_port'
  | 'blocked_address'
  | 'network'
  | 'http_error';

export interface SendRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface SendResult {
  /** `null` when no HTTP response arrived (timeout, DNS, TLS…). */
  statusCode: number | null;
  durationMs: number;
  responseHeaders: Record<string, string> | null;
  /** First `MAX_RESPONSE_BODY_BYTES` of the body, decoded as UTF-8. */
  responseBody: string | null;
  errorCode: DeliveryErrorCode | null;
  errorMessage: string | null;
}

/** Enough to show a receiver's error page or JSON error; bounds storage per attempt. */
export const MAX_RESPONSE_BODY_BYTES = 4 * 1024;

export type Sender = (request: SendRequest) => Promise<SendResult>;

/** Resolves every address for a hostname (injectable for tests). */
export type ResolveAll = (hostname: string) => Promise<LookupAddress[]>;

const systemResolveAll: ResolveAll = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses),
    ),
  );

/** Thrown from the connect-time lookup; surfaces as `cause.code` on the fetch error. */
const BLOCKED_ADDRESS = 'ERR_RELAY_BLOCKED_ADDRESS';

function blockedAddressError(hostname: string, address: string): Error {
  return Object.assign(
    new Error(`${hostname} resolved to ${address}, which is not a public address`),
    { code: BLOCKED_ADDRESS },
  );
}

/**
 * A DNS lookup for the HTTP agent that refuses non-public answers. It runs at
 * **connect time**, on the exact addresses the socket is about to use, so a
 * hostname that was public when the endpoint was registered and later
 * re-pointed at 127.0.0.1 or 169.254.169.254 (DNS rebinding) is still blocked.
 * Every answer must be public, not just the first: with Happy Eyeballs the
 * socket may try any of them.
 */
export function guardedLookup(resolveAll: ResolveAll = systemResolveAll): LookupFunction {
  return (hostname, options, callback) => {
    resolveAll(hostname).then(
      (all) => {
        const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
        const addresses = wanted ? all.filter((a) => a.family === wanted) : all;
        const blocked = all.find((a) => !isPublicAddress(a.address));
        if (blocked) return callback(blockedAddressError(hostname, blocked.address), '', 0);
        if (addresses.length === 0) {
          const error = Object.assign(new Error(`No addresses found for ${hostname}`), {
            code: 'ENOTFOUND',
          });
          return callback(error, '', 0);
        }
        if (options.all) return callback(null, addresses);
        return callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, '', 0),
    );
  };
}

export interface SenderOptions {
  policy: UrlPolicy;
  /** Test seam for the strict-mode DNS check. */
  resolveAll?: ResolveAll;
}

/**
 * Builds the worker's sender. In `strict` mode (production) every connection
 * goes through `guardedLookup`, and IP-literal URLs (which skip DNS) are
 * checked before connecting. One agent per worker, so connections are pooled.
 */
export function createSender(options: SenderOptions): Sender {
  if (options.policy === 'permissive') {
    const dispatcher = new Agent();
    return (request) => send(request, dispatcher);
  }
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(options.resolveAll) } });
  return (request) => {
    const host = new URL(request.url).hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublicAddress(host)) {
      return Promise.resolve(failure(0, 'blocked_address', `${host} is not a public address`));
    }
    return send(request, dispatcher);
  };
}

/** Permissive sender for tests and local development. */
export const sendWebhook: Sender = createSender({ policy: 'permissive' });

function failure(durationMs: number, code: DeliveryErrorCode, message: string): SendResult {
  return {
    statusCode: null,
    durationMs,
    responseHeaders: null,
    responseBody: null,
    errorCode: code,
    errorMessage: message,
  };
}

async function send(request: SendRequest, dispatcher: Dispatcher): Promise<SendResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  try {
    const response = await fetch(request.url, {
      dispatcher,
      method: 'POST',
      headers: request.headers,
      body: request.body,
      // A redirect is treated as a failed delivery, never followed: following
      // it would send the signed payload to a URL the customer never
      // registered (and is a classic SSRF bypass).
      redirect: 'manual',
      // One deadline covers connect, headers and the (truncated) body read.
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    const responseBody = await readTruncated(response);
    const ok = response.status >= 200 && response.status < 300;
    return {
      statusCode: response.status,
      durationMs: elapsed(),
      responseHeaders: Object.fromEntries(response.headers),
      responseBody,
      errorCode: ok ? null : 'http_error',
      errorMessage: ok ? null : `Endpoint responded with HTTP ${response.status}`,
    };
  } catch (error) {
    const { code, message } = classifyError(error, request.timeoutMs);
    return failure(elapsed(), code, message);
  }
}

async function readTruncated(response: Awaited<ReturnType<typeof fetch>>): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_RESPONSE_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    // Stop downloading: a receiver streaming a huge body must not tie up the worker.
    await reader.cancel().catch(() => {});
  }
  const bytes = Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BODY_BYTES);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** Maps Node/undici failures to stable error classes with a user-readable message. */
export function classifyError(
  error: unknown,
  timeoutMs: number,
): { code: DeliveryErrorCode; message: string } {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { code: 'timeout', message: `No response within ${timeoutMs} ms` };
  }

  // fetch wraps the real cause: TypeError('fetch failed', { cause: { code, … } })
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  const detail = typeof cause?.message === 'string' ? cause.message : String(error);

  // fetch refuses the WHATWG "bad ports" (e.g. 1, 25, 6000, 10080) before connecting.
  if (detail === 'bad port') {
    return {
      code: 'blocked_port',
      message: 'This port is blocked for HTTP requests; use a standard port such as 443',
    };
  }
  if (code === BLOCKED_ADDRESS) return { code: 'blocked_address', message: detail };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NONAME') {
    return { code: 'dns', message: `DNS lookup failed (${code})` };
  }
  if (code === 'ECONNREFUSED') return { code: 'connection_refused', message: 'Connection refused' };
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') {
    return { code: 'connection_reset', message: 'Connection closed unexpectedly' };
  }
  if (code.startsWith('ERR_TLS') || code.includes('CERT') || code.includes('SELF_SIGNED')) {
    return { code: 'tls', message: `TLS error (${code})` };
  }
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return { code: 'timeout', message: `Timed out (${code})` };
  }
  return { code: 'network', message: code ? `Network error (${code})` : detail };
}

/** Failures that can never succeed on retry: the endpoint configuration must change. */
export const PERMANENT_ERROR_CODES: ReadonlySet<DeliveryErrorCode> = new Set([
  'blocked_port',
  'blocked_address',
]);

/**
 * Parses `Retry-After` (delta-seconds or HTTP-date) into milliseconds.
 * Returns `undefined` when absent or unparseable.
 */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
