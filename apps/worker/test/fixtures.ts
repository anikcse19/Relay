import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo, createServer as createTcpServer } from 'node:net';
import {
  type Database,
  deliveries,
  endpoints,
  environments,
  events,
  organizations,
} from '@relay/db';
import { generateSigningSecret, newId } from '@relay/shared';

export interface ReceivedRequest {
  headers: IncomingMessage['headers'];
  body: string;
}

/**
 * A real HTTP server on 127.0.0.1 acting as a customer's webhook endpoint.
 * `respond` decides each response; every request is recorded.
 */
export async function startReceiver() {
  const received: ReceivedRequest[] = [];
  let respond: (req: ReceivedRequest, res: ServerResponse) => void = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const request = { headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      received.push(request);
      respond(request, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    received,
    respondWith(fn: typeof respond) {
      respond = fn;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface Seeded {
  organizationId: string;
  environmentId: string;
  endpointId: string;
  eventId: string;
  deliveryId: string;
  secret: string;
}

/** Inserts org → environment → endpoint → event → pending delivery. */
export async function seedDelivery(
  db: Database,
  url: string,
  endpoint: Partial<typeof endpoints.$inferInsert> = {},
): Promise<Seeded> {
  const organizationId = newId('organization');
  const environmentId = newId('environment');
  const endpointId = newId('endpoint');
  const eventId = newId('event');
  const deliveryId = newId('delivery');
  const secret = generateSigningSecret();

  await db.insert(organizations).values({ id: organizationId, name: 'Acme', slug: organizationId });
  await db.insert(environments).values({
    id: environmentId,
    organizationId,
    name: 'Development',
    kind: 'development',
  });
  await db.insert(endpoints).values({
    id: endpointId,
    organizationId,
    environmentId,
    url,
    signingSecret: secret,
    ...endpoint,
  });
  await db.insert(events).values({
    id: eventId,
    organizationId,
    environmentId,
    eventType: 'invoice.paid',
    payload: { invoiceId: 'inv_1', amount: 4200, nested: { b: 2, a: 1 } },
  });
  await db.insert(deliveries).values({
    id: deliveryId,
    organizationId,
    environmentId,
    eventId,
    endpointId,
    nextAttemptAt: new Date(),
  });

  return { organizationId, environmentId, endpointId, eventId, deliveryId, secret };
}

/** A free local port with nothing listening on it (for "connection refused"). */
export function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createTcpServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}
