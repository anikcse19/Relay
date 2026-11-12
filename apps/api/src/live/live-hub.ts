import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@nestjs/common';
import { LIVE_CHANNEL, type Listener, type LiveMessage, type Unlisten } from '@relay/db';
import { LISTENER } from '../database/database.module.js';

/** Writes one Server-Sent Event to a subscriber. */
export type Send = (event: string, data: unknown) => void;

/** A live subscriber: how to send it an event, and how to end its stream. */
export interface Subscriber {
  send: Send;
  close: () => void;
}

/**
 * Fans Postgres notifications out to live subscribers (ADR-0016).
 *
 * One LISTEN connection per API process, opened on the first subscriber
 * (so the API still boots, and serves everything else, when the database is
 * down). Each message goes only to subscribers of its environment. If the
 * LISTEN connection drops, messages sent meanwhile are lost, so every
 * subscriber gets a `resync` and refetches.
 *
 * On shutdown the hub ends every stream first: an open SSE response would
 * otherwise keep the HTTP server from closing (a restart or deploy would
 * hang). Clients reconnect to the next process by themselves.
 */
@Injectable()
export class LiveHub implements OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger('LiveHub');
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private listening: Promise<Unlisten> | null = null;

  constructor(@Inject(LISTENER) private readonly listener: Listener) {}

  /** Starts delivering messages for `environmentId` to `send`. Returns the unsubscribe function. */
  async subscribe(environmentId: string, subscriber: Subscriber): Promise<() => void> {
    await this.ensureListening();
    let set = this.subscribers.get(environmentId);
    if (!set) this.subscribers.set(environmentId, (set = new Set()));
    set.add(subscriber);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(environmentId);
    };
  }

  /** Current subscriber count (for tests and metrics). */
  get size(): number {
    let n = 0;
    for (const set of this.subscribers.values()) n += set.size;
    return n;
  }

  /** Runs before the HTTP server closes: end every stream so it can. */
  onModuleDestroy(): void {
    for (const set of this.subscribers.values()) for (const subscriber of set) subscriber.close();
    this.subscribers.clear();
  }

  async onApplicationShutdown(): Promise<void> {
    const unlisten = await this.listening?.catch(() => null);
    await unlisten?.();
  }

  private ensureListening(): Promise<Unlisten> {
    if (!this.listening) {
      this.listening = this.listener
        .listen(LIVE_CHANNEL, (payload) => this.dispatch(payload))
        .then((unlisten) => {
          this.listener.onReconnect(() => this.broadcast('resync', {}));
          return unlisten;
        })
        .catch((error: unknown) => {
          this.listening = null; // let the next subscriber try again
          throw error;
        });
    }
    return this.listening;
  }

  private dispatch(payload: string): void {
    let message: LiveMessage;
    try {
      message = JSON.parse(payload) as LiveMessage;
    } catch {
      this.logger.warn(`Ignoring malformed live message: ${payload.slice(0, 100)}`);
      return;
    }
    for (const subscriber of this.subscribers.get(message.environmentId) ?? []) {
      subscriber.send(message.type, message);
    }
  }

  private broadcast(event: string, data: unknown): void {
    for (const set of this.subscribers.values()) for (const s of set) s.send(event, data);
  }
}
