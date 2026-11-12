import pg from 'pg';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/**
 * Live updates over Postgres LISTEN/NOTIFY (ADR-0016).
 *
 * `NOTIFY` is transactional: a message published inside a transaction is
 * delivered only if (and when) it commits. Producers publish in the same
 * transaction as the change, so listeners never hear about a change that
 * rolled back, and never hear about it before it's visible to their reads.
 * Payloads carry ids and small facts only (NOTIFY's limit is 8 kB).
 */

/** Dashboard-facing changes, fanned out by the API to SSE subscribers. */
export const LIVE_CHANNEL = 'relay_live';
/** "A job was enqueued on queue X": wakes idle workers immediately. */
export const JOBS_CHANNEL = 'relay_jobs';

export type DeliveryStatusName = 'pending' | 'retrying' | 'succeeded' | 'failed' | 'cancelled';

export type LiveMessage =
  | {
      type: 'event.created';
      environmentId: string;
      event: {
        id: string;
        type: string;
        createdAt: string;
        deliveryCounts: Record<DeliveryStatusName, number>;
      };
    }
  | {
      type: 'delivery.updated';
      environmentId: string;
      deliveryId: string;
      eventId: string;
      /** Status before and after, so lists can adjust counts in place. */
      from: DeliveryStatusName;
      to: DeliveryStatusName;
      attemptCount: number;
    }
  | { type: 'notification.created'; environmentId: string; notificationId: string };

type Executor = Pick<Database, 'execute'>;

/** Publishes a live message; call inside the transaction that makes the change. */
export async function publish(executor: Executor, message: LiveMessage): Promise<void> {
  await executor.execute(sql`select pg_notify(${LIVE_CHANNEL}, ${JSON.stringify(message)})`);
}

/** Wakes workers listening for jobs on `queue`; call inside the enqueuing transaction. */
export async function notifyJobs(executor: Executor, queue: string): Promise<void> {
  await executor.execute(sql`select pg_notify(${JOBS_CHANNEL}, ${queue})`);
}

export type Unlisten = () => Promise<void>;

/** Subscribes to a channel. Messages sent while disconnected are lost: use `onReconnect` to resync. */
export interface Listener {
  listen(channel: string, onPayload: (payload: string) => void): Promise<Unlisten>;
  /** Called after the connection was lost and re-established. */
  onReconnect(callback: () => void): void;
  close(): Promise<void>;
}

const CHANNEL_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * One dedicated connection per process for LISTEN (pooled connections can't
 * hold a LISTEN). Reconnects with backoff and re-subscribes every channel;
 * Neon may drop idle connections or restart computes at any time.
 */
export function createPgListener(
  connectionString: string,
  onError: (error: unknown) => void = () => {},
): Listener {
  const handlers = new Map<string, Set<(payload: string) => void>>();
  const reconnectCallbacks: (() => void)[] = [];
  let client: pg.Client | null = null;
  let connecting: Promise<pg.Client> | null = null;
  let closed = false;
  let everConnected = false;
  let retryMs = 500;
  let retryTimer: NodeJS.Timeout | null = null;

  const connect = async (): Promise<pg.Client> => {
    const c = new pg.Client({ connectionString });
    c.on('notification', (msg) => {
      for (const handler of handlers.get(msg.channel) ?? []) handler(msg.payload ?? '');
    });
    c.on('error', (error) => {
      onError(error);
      scheduleReconnect(c);
    });
    c.on('end', () => scheduleReconnect(c));
    await c.connect();
    for (const channel of handlers.keys()) await c.query(`LISTEN ${channel}`);
    client = c;
    retryMs = 500;
    if (everConnected) reconnectCallbacks.forEach((cb) => cb());
    everConnected = true;
    return c;
  };

  const ensure = (): Promise<pg.Client> => {
    if (client) return Promise.resolve(client);
    connecting ??= connect().finally(() => {
      connecting = null;
    });
    return connecting;
  };

  /** Retries `ensure()` with exponential backoff (0.5 s → 30 s) until it succeeds or we close. */
  function retryLater() {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      ensure().catch((error: unknown) => {
        onError(error);
        retryMs = Math.min(retryMs * 2, 30_000);
        retryLater();
      });
    }, retryMs);
    retryTimer.unref();
  }

  function scheduleReconnect(dead: pg.Client) {
    if (closed || client !== dead) return; // stale event from an older connection
    client = null;
    dead.removeAllListeners();
    dead.on('error', () => {}); // a late error from a dead socket must not crash the process
    void dead.end().catch(() => {});
    retryLater();
  }

  return {
    async listen(channel, onPayload) {
      if (!CHANNEL_NAME.test(channel)) throw new Error(`Invalid channel name: ${channel}`);
      let set = handlers.get(channel);
      if (set) {
        set.add(onPayload); // already LISTENing (or will be, on reconnect)
      } else {
        handlers.set(channel, (set = new Set([onPayload])));
        try {
          const c = await ensure();
          await c.query(`LISTEN ${channel}`); // harmless if connect() already did
        } catch (error) {
          // Roll back, so a later listen() retries instead of assuming success.
          handlers.delete(channel);
          throw error;
        }
      }
      return async () => {
        set.delete(onPayload);
        if (set.size === 0) {
          handlers.delete(channel);
          await client?.query(`UNLISTEN ${channel}`).catch(() => {});
        }
      };
    },
    onReconnect(callback) {
      reconnectCallbacks.push(callback);
    },
    async close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      const c = client;
      client = null;
      c?.removeAllListeners();
      c?.on('error', () => {});
      await c?.end().catch(() => {});
    },
  };
}
