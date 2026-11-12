/**
 * Public URL of the Relay API, as producers call it (curl snippets, docs
 * link). `NEXT_PUBLIC_*` values are inlined into the client bundle at build.
 */
export const API_PUBLIC_URL = (
  process.env.NEXT_PUBLIC_API_PUBLIC_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');
