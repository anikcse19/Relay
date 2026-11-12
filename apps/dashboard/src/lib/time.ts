const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "3 minutes ago", "in 2 days". */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 45) return 'just now';
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds / 60), 'minute');
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "12 Nov 14:00" in the viewer's time zone. */
export function formatDayTime(date: Date): string {
  return `${dayFormat.format(date)} ${timeFormat.format(date)}`;
}

/**
 * A time-range filter, local time: "12 Nov 14:00–15:00", "5 Nov" (one whole
 * local day), "5 Nov 06:00 – 6 Nov 06:00"; open ends read "since …"/"before …".
 */
export function formatTimeRange(from?: string, to?: string): string {
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;
  if (start && end) {
    const sameDay = dayFormat.format(start) === dayFormat.format(end);
    const isMidnight = (d: Date) => d.getHours() === 0 && d.getMinutes() === 0;
    if (isMidnight(start) && isMidnight(end) && end.getTime() - start.getTime() === 86_400_000) {
      return dayFormat.format(start);
    }
    return sameDay
      ? `${formatDayTime(start)}–${timeFormat.format(end)}`
      : `${formatDayTime(start)} – ${formatDayTime(end)}`;
  }
  if (start) return `since ${formatDayTime(start)}`;
  return end ? `before ${formatDayTime(end)}` : '';
}
