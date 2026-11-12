'use client';

import { useEffect, useState } from 'react';
import { formatRelative } from '@/lib/time';

/**
 * Relative time with the exact UTC and local time on hover (guidelines §4.4).
 * Re-renders every 30 s so "just now" doesn't go stale on an open page.
 */
export function RelativeTime({ value }: { value: string | Date }) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const utc = date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const local = date.toLocaleString();
  return (
    // Server and client clocks differ by a few ms; the text may legitimately differ.
    <time dateTime={date.toISOString()} title={`${utc}\n${local} (local)`} suppressHydrationWarning>
      {formatRelative(date, now)}
    </time>
  );
}
