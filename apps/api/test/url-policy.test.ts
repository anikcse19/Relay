import { describe, expect, it } from 'vitest';
import {
  checkEndpointUrl,
  EndpointUrlError,
  isPublicAddress,
  type Resolver,
  urlPolicyFor,
} from '../src/endpoints/url-policy.js';

const resolvesTo =
  (...addresses: string[]): Resolver =>
  async () =>
    addresses;
const publicDns = resolvesTo('93.184.215.14');

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata service
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '64:ff9b::a00:1', // NAT64 of 10.0.0.1
    'not-an-ip',
  ])('rejects %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['93.184.215.14', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'accepts %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe('checkEndpointUrl (strict)', () => {
  const strict = (url: string, resolve: Resolver = publicDns) =>
    checkEndpointUrl(url, 'strict', resolve);

  it('accepts a public https URL and normalises it', async () => {
    await expect(strict('https://Example.COM/hooks?x=1#frag')).resolves.toBe(
      'https://example.com/hooks?x=1',
    );
  });

  it.each([
    ['not a url', /full URL/],
    ['http://example.com/hooks', /https/],
    ['ftp://example.com', /https/],
    ['https://user:pass@example.com/', /credentials/],
    ['https://localhost/hooks', /private or internal/],
    ['https://api.localhost/hooks', /private or internal/],
    ['https://db.internal/hooks', /private or internal/],
    ['https://printer.local/hooks', /private or internal/],
    ['https://intranet/hooks', /private or internal/],
    ['https://127.0.0.1/hooks', /private or internal/],
    ['https://169.254.169.254/latest/meta-data', /private or internal/],
    ['https://[::1]/hooks', /private or internal/],
    ['https://[::ffff:10.0.0.1]/hooks', /private or internal/],
  ])('rejects %s', async (url, message) => {
    await expect(strict(url)).rejects.toThrow(message);
  });

  it('rejects hostnames that resolve to a private address', async () => {
    await expect(strict('https://evil.example', resolvesTo('10.0.0.5'))).rejects.toThrow(
      EndpointUrlError,
    );
  });

  it('rejects hostnames where any address is private (rebinding setup)', async () => {
    await expect(
      strict('https://evil.example', resolvesTo('93.184.215.14', '127.0.0.1')),
    ).rejects.toThrow(/private or internal/);
  });

  it('rejects hostnames that do not resolve', async () => {
    const failing: Resolver = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    await expect(strict('https://nope.example', failing)).rejects.toThrow(/could not be resolved/);
  });

  it('accepts public IP literals without a DNS lookup', async () => {
    const neverCalled: Resolver = async () => {
      throw new Error('should not resolve');
    };
    await expect(strict('https://93.184.215.14/hooks', neverCalled)).resolves.toBe(
      'https://93.184.215.14/hooks',
    );
  });
});

describe('checkEndpointUrl (permissive)', () => {
  it('allows http and localhost for local development', async () => {
    await expect(checkEndpointUrl('http://localhost:4000/hooks', 'permissive')).resolves.toBe(
      'http://localhost:4000/hooks',
    );
  });

  it('still rejects other schemes and credentials', async () => {
    await expect(checkEndpointUrl('file:///etc/passwd', 'permissive')).rejects.toThrow(/http/);
    await expect(checkEndpointUrl('http://a:b@localhost/', 'permissive')).rejects.toThrow(
      /credentials/,
    );
  });
});

describe('urlPolicyFor', () => {
  it('is strict in production and permissive elsewhere, unless overridden', () => {
    expect(urlPolicyFor({ NODE_ENV: 'production' })).toBe('strict');
    expect(urlPolicyFor({ NODE_ENV: 'development' })).toBe('permissive');
    expect(urlPolicyFor({ NODE_ENV: 'development', ENDPOINT_URL_POLICY: 'strict' })).toBe('strict');
  });
});
