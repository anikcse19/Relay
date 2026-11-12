import { describe, expect, it } from 'vitest';
import { initials, middleTruncate } from '../src/lib/format';
import type { Me } from '../src/lib/types';
import { resolveWorkspace, switchEnvironmentPath } from '../src/lib/workspace';

describe('middleTruncate', () => {
  it('keeps the prefix and the tail of long ids', () => {
    expect(middleTruncate('evt_01JD3X8Z5K2M4N6P8Q0R2S4T6V')).toBe('evt_01JD…4T6V');
  });
  it('leaves short values alone', () => {
    expect(middleTruncate('org_123')).toBe('org_123');
    expect(middleTruncate('abcdefghijklm')).toBe('abcdefghijklm'); // exactly head+tail+1
  });
});

describe('initials', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['grace', 'G'],
    ['  Grace  Brewster Murray Hopper ', 'GH'],
    ['', '?'],
  ])('%j → %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe('workspace routing', () => {
  const me: Me = {
    user: { id: 'usr_1', name: 'Ada', email: 'a@x.dev', emailVerified: false, image: null },
    activeOrganizationId: 'org_1',
    organizations: [
      {
        id: 'org_1',
        name: 'Acme',
        slug: 'acme-abc123',
        role: 'owner',
        environments: [
          { id: 'env_dev', name: 'Development', kind: 'development' },
          { id: 'env_prod', name: 'Production', kind: 'production' },
        ],
      },
    ],
  };

  it('resolves only workspaces the user belongs to', () => {
    expect(resolveWorkspace(me, 'acme-abc123', 'env_prod')?.env.kind).toBe('production');
    expect(resolveWorkspace(me, 'other-org', 'env_prod')).toBeNull();
    expect(resolveWorkspace(me, 'acme-abc123', 'env_of_someone_else')).toBeNull();
  });

  it('switches environment while keeping the rest of the path', () => {
    expect(switchEnvironmentPath('/acme/env_dev', 'env_prod')).toBe('/acme/env_prod');
    expect(switchEnvironmentPath('/acme/env_dev/api-keys', 'env_prod')).toBe(
      '/acme/env_prod/api-keys',
    );
  });
});
