import { describe, expect, it } from 'vitest';
import { generateSigningSecret, sign, verify, WebhookVerificationError } from '../src/signing.js';

const body = JSON.stringify({ type: 'invoice.paid', data: { id: 'inv_1' } });
const now = 1_731_337_200;

describe('webhook signing', () => {
  it('signs and verifies a payload', () => {
    const secret = generateSigningSecret();
    const headers = sign(secret, 'msg_1', body, now);
    expect(headers['webhook-signature']).toMatch(/^v1,/);
    expect(() => verify(secret, headers, body, { now })).not.toThrow();
  });

  it('matches the Standard Webhooks reference vector', () => {
    // Test vector from the standard-webhooks reference implementations.
    const headers = sign(
      'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
      'msg_p5jXN8AQM9LWM0D4loKWxJek',
      '{"test": 2432232314}',
      1614265330,
    );
    expect(headers['webhook-signature']).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
  });

  it('rejects a tampered body', () => {
    const secret = generateSigningSecret();
    const headers = sign(secret, 'msg_1', body, now);
    expect(() => verify(secret, headers, body + ' ', { now })).toThrow(WebhookVerificationError);
  });

  it('rejects a stale timestamp (replay protection)', () => {
    const secret = generateSigningSecret();
    const headers = sign(secret, 'msg_1', body, now - 3600);
    expect(() => verify(secret, headers, body, { now })).toThrow(/tolerance/);
  });

  it('supports secret rotation with multiple signatures', () => {
    const oldSecret = generateSigningSecret();
    const newSecret = generateSigningSecret();
    const headers = sign([oldSecret, newSecret], 'msg_1', body, now);
    expect(headers['webhook-signature'].split(' ')).toHaveLength(2);
    expect(() => verify(oldSecret, headers, body, { now })).not.toThrow();
    expect(() => verify(newSecret, headers, body, { now })).not.toThrow();
  });
});
