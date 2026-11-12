import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { LIVE_CHANNEL, type Listener, type LiveMessage, type Unlisten } from '@relay/db';
import { LISTENER } from '../database/database.module.js';

/** Writes one Server-Sent Event to a subscriber. */
export type Send = (event: string, data: unknown) => void;

/**
 * Fans Postgres notifications out to live subscribers (ADR-0016).
 *
 * One LISTEN connection per API process, opened on the first subscriber
 * (so the API still boots, and serves everything else, when the database is
 * down). Each message goes only to subscribers of its environment. If the
 * LISTEN connection drops, messages sent meanwhile are lost, so every
 * subscriber gets a `resync` and refetches.
 */
@Injectable()
export class LiveHub implements OnApplicationShutdown {
  private readonly logger = new Logger('LiveHub');
  private readonly subscribers = new Map<string, Set<Send>>();
  private listening: Promise<Unlisten> | null = null;

  constructor(@Inject(LISTENER) private readonly listener: Listener) {}

  /** Starts delivering messages for `environmentId` to `send`. Returns the unsubscribe function. */
  async subscribe(environmentId: string, send: Send): Promise<() => void> {
    await this.ensureListening();
    let set = this.subscribers.get(environmentId);
    if (!set) this.subscribers.set(environmentId, (set = new Set()));
    set.add(send);
    return () => {
      set.delete(send);
      if (set.size === 0) this.subscribers.delete(environmentId);
    };
  }

  /** Current subscriber count (for tests and metrics). */
  get size(): number {
    let n = 0;
    for (const set of this.subscribers.values()) n += set.size;
    return n;
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
    for (const send of this.subscribers.get(message.environmentId) ?? []) {
      send(message.type, message);
    }
  }

  private broadcast(event: string, data: unknown): void {
    for (const set of this.subscribers.values()) for (const send of set) send(event, data);
  }
}
