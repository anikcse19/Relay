import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  classifyError,
  MAX_RESPONSE_BODY_BYTES,
  parseRetryAfter,
  sendWebhook,
} from '../src/http-client.js';
import { closedPort, startReceiver } from './fixtures.js';

describe('sendWebhook', () => {
  let receiver: Awaited<ReturnType<typeof startReceiver>>;

  beforeAll(async () => {
    receiver = await startReceiver();
  });
  afterAll(async () => {
    await receiver.close();
  });

  const send = (path = '/', timeoutMs = 2_000) =>
    sendWebhook({
      url: `${receiver.url}${path}`,
      headers: { 'content-type': 'application/json', 'x-test': '1' },
      body: '{"hello":"world"}',
      timeoutMs,
    });

  it('records a successful response', async () => {
    receiver.respondWith((_req, res) => res.writeHead(200, { 'x-reply': 'yes' }).end('thanks'));
    const result = await send();
    expect(result).toMatchObject({
      statusCode: 200,
      responseBody: 'thanks',
      errorCode: null,
      errorMessage: null,
    });
    expect(result.responseHeaders?.['x-reply']).toBe('yes');
    expect(receiver.received.at(-1)).toMatchObject({
      body: '{"hello":"world"}',
      headers: { 'x-test': '1' },
    });
  });

  it('classifies non-2xx responses as http_error', async () => {
    receiver.respondWith((_req, res) => res.writeHead(503).end('down'));
    expect(await send()).toMatchObject({ statusCode: 503, errorCode: 'http_error' });
  });

  it('truncates large response bodies without downloading them fully', async () => {
    receiver.respondWith((_req, res) => {
      res.writeHead(200);
      res.end('x'.repeat(5 * 1024 * 1024));
    });
    const result = await send();
    expect(result.statusCode).toBe(200);
    expect(result.responseBody).toHaveLength(MAX_RESPONSE_BODY_BYTES);
  });

  it('does not follow redirects', async () => {
    const before = receiver.received.length;
    receiver.respondWith((req, res) =>
      res.writeHead(302, { location: `${receiver.url}/elsewhere` }).end(),
    );
    const result = await send();
    expect(result).toMatchObject({ statusCode: 302, errorCode: 'http_error' });
    expect(receiver.received.length).toBe(before + 1); // the redirect target was never requested
  });

  it('times out a receiver that never answers', async () => {
    receiver.respondWith(() => {}); // hang
    const result = await send('/', 200);
    expect(result).toMatchObject({ statusCode: null, errorCode: 'timeout' });
    expect(result.durationMs).toBeGreaterThanOrEqual(190);
  });

  it('reports connection refused', async () => {
    const port = await closedPort();
    const result = await sendWebhook({
      url: `http://127.0.0.1:${port}/`,
      headers: {},
      body: '{}',
      timeoutMs: 2_000,
    });
    expect(result).toMatchObject({ statusCode: null, errorCode: 'connection_refused' });
  });
});

describe('classifyError', () => {
  const wrap = (code: string) => new TypeError('fetch failed', { cause: { code } });

  it.each([
    ['ENOTFOUND', 'dns'],
    ['EAI_AGAIN', 'dns'],
    ['ECONNREFUSED', 'connection_refused'],
    ['ECONNRESET', 'connection_reset'],
    ['UND_ERR_SOCKET', 'connection_reset'],
    ['CERT_HAS_EXPIRED', 'tls'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['EHOSTUNREACH', 'network'],
  ])('%s → %s', (code, expected) => {
    expect(classifyError(wrap(code), 1000).code).toBe(expected);
  });

  it('flags fetch-blocked ports as a permanent error', () => {
    const error = new TypeError('fetch failed', { cause: new Error('bad port') });
    expect(classifyError(error, 1000).code).toBe('blocked_port');
  });

  it('maps abort/timeout errors', () => {
    const error = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(classifyError(error, 1500)).toEqual({
      code: 'timeout',
      message: 'No response within 1500 ms',
    });
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');

  it('parses delta-seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000);
  });
  it('parses an HTTP-date', () => {
    expect(parseRetryAfter('Thu, 12 Nov 2026 12:01:00 GMT', now)).toBe(60_000);
  });
  it('clamps past dates to zero', () => {
    expect(parseRetryAfter('Thu, 12 Nov 2026 11:00:00 GMT', now)).toBe(0);
  });
  it('ignores missing or garbage values', () => {
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });
});
