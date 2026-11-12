import { API_PUBLIC_URL } from '@/lib/config';

export type Expiry = 'never' | '30' | '90' | '365';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `'30'` → ISO timestamp 30 days from `now`; `'never'` → undefined. */
export function expiryToIso(expiry: Expiry, now: number = Date.now()): string | undefined {
  return expiry === 'never' ? undefined : new Date(now + Number(expiry) * DAY_MS).toISOString();
}

export function curlSnippet(key: string): string {
  return [
    `curl -X POST ${API_PUBLIC_URL}/v1/events \\`,
    `  -H "Authorization: Bearer ${key}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"type":"invoice.paid","data":{"invoiceId":"inv_123","amount":4200}}'`,
  ].join('\n');
}
