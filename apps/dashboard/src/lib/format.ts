/**
 * Middle-truncates an identifier so both the prefix (what kind of thing it
 * is) and the tail (what tells two ids apart) stay visible:
 * `evt_01JD3X8Z5K2M4N6P8Q0R2S4T6V` → `evt_01JD…4T6V`.
 */
export function middleTruncate(value: string, head = 8, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Initials for an avatar: "Ada Lovelace" → "AL", "grace" → "G". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts.at(-1)![0]] : [parts[0]?.[0]];
  return letters.join('').toUpperCase() || '?';
}
