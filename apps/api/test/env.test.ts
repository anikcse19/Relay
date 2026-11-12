import { describe, expect, it } from 'vitest';
import { ConfigError, parseEnv } from '../src/config/env.js';

const required = {
  DATABASE_URL: 'postgresql://u:p@host/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(required);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      BETTER_AUTH_URL: 'http://localhost:3000',
      DASHBOARD_URL: 'http://localhost:3001',
    });
  });

  it('coerces numeric values', () => {
    expect(parseEnv({ ...required, PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails fast with a readable message when DATABASE_URL is missing', () => {
    const rest = { BETTER_AUTH_SECRET: required.BETTER_AUTH_SECRET };
    expect(() => parseEnv(rest)).toThrow(ConfigError);
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects non-postgres URLs', () => {
    expect(() => parseEnv({ ...required, DATABASE_URL: 'mysql://h/db' })).toThrow(/postgres/);
  });

  it('rejects a short auth secret', () => {
    expect(() => parseEnv({ ...required, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('requires both GitHub OAuth credentials or neither', () => {
    expect(() => parseEnv({ ...required, GITHUB_CLIENT_ID: 'abc' })).toThrow(/set together/);
    expect(
      parseEnv({ ...required, GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b' }),
    ).toMatchObject({ GITHUB_CLIENT_ID: 'a' });
  });
});
