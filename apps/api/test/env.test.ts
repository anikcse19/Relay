import { describe, expect, it } from 'vitest';
import { ConfigError, parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv({ DATABASE_URL: 'postgresql://u:p@host/db' });
    expect(env).toMatchObject({ NODE_ENV: 'development', PORT: 3000, LOG_LEVEL: 'info' });
  });

  it('coerces numeric values', () => {
    expect(parseEnv({ DATABASE_URL: 'postgres://h/db', PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails fast with a readable message when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow(ConfigError);
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects non-postgres URLs', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://h/db' })).toThrow(/postgres/);
  });
});
