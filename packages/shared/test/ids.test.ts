import { describe, expect, it } from 'vitest';
import { idTimestamp, isId, newId } from '../src/ids.js';

describe('ids', () => {
  it('generates prefixed ids of the expected shape', () => {
    const id = newId('event');
    expect(id).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isId(id, 'event')).toBe(true);
    expect(isId(id, 'endpoint')).toBe(false);
  });

  it('sorts lexicographically by creation time', () => {
    const a = newId('event', 1_700_000_000_000);
    const b = newId('event', 1_700_000_000_001);
    const c = newId('event', 1_800_000_000_000);
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });

  it('round-trips the embedded timestamp', () => {
    const ms = 1_731_337_200_123;
    expect(idTimestamp(newId('delivery', ms)).getTime()).toBe(ms);
  });

  it('is unique across many generations', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId('event')));
    expect(ids.size).toBe(10_000);
  });
});
