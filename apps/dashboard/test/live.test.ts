import { describe, expect, it } from 'vitest';
import { applyStatusChange, patchEventPages, unseenEvents } from '@/features/live/messages';
import type { EventSummary } from '@/lib/types';

const event = (id: string, type = 'invoice.paid', pending = 1): EventSummary => ({
  id,
  type,
  createdAt: '2026-11-12T00:00:00Z',
  deliveryCounts: { pending, retrying: 0, succeeded: 0, failed: 0, cancelled: 0 },
});

describe('applyStatusChange', () => {
  it('moves one delivery between buckets', () => {
    const moved = applyStatusChange(event('evt_1', 'x', 2), 'pending', 'succeeded');
    expect(moved.deliveryCounts).toMatchObject({ pending: 1, succeeded: 1 });
  });

  it('never goes negative (a message for a delivery we never counted)', () => {
    const moved = applyStatusChange(event('evt_1', 'x', 0), 'retrying', 'failed');
    expect(moved.deliveryCounts).toMatchObject({ retrying: 0, failed: 1 });
  });

  it('is a no-op for same-status updates', () => {
    const e = event('evt_1');
    expect(applyStatusChange(e, 'pending', 'pending')).toBe(e);
  });
});

describe('patchEventPages', () => {
  const data = {
    pages: [
      { data: [event('evt_3'), event('evt_2')], nextCursor: 'evt_2' },
      { data: [event('evt_1')], nextCursor: null },
    ],
    pageParams: [undefined, 'evt_2'],
  };

  it('updates counts in place on whichever page holds the event, keeping order', () => {
    const next = patchEventPages(data, 'evt_1', 'pending', 'retrying')!;
    expect(next.pages.flatMap((p) => p.data.map((e) => e.id))).toEqual(['evt_3', 'evt_2', 'evt_1']);
    expect(next.pages[1]!.data[0]!.deliveryCounts).toMatchObject({ pending: 0, retrying: 1 });
    expect(next.pages[0]).toEqual(data.pages[0]);
  });

  it('returns the same object when the event is not loaded (no re-render)', () => {
    expect(patchEventPages(data, 'evt_404', 'pending', 'succeeded')).toBe(data);
    expect(patchEventPages(undefined, 'evt_1', 'pending', 'succeeded')).toBeUndefined();
  });
});

describe('unseenEvents', () => {
  const buffered = [event('evt_5', 'user.created'), event('evt_4'), event('evt_3')];

  it('counts only events not already visible', () => {
    expect(unseenEvents(buffered, new Set(['evt_3'])).map((e) => e.id)).toEqual(['evt_5', 'evt_4']);
  });

  it('respects the type filter', () => {
    expect(unseenEvents(buffered, new Set(), 'user.created').map((e) => e.id)).toEqual(['evt_5']);
  });
});
