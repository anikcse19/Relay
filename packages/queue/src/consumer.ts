import { hostname } from 'node:os';
import { DEFAULT_BACKOFF, nextRetryDelay, type BackoffPolicy } from '@relay/shared';
import type { Job, QueueTransport } from './transport.js';

/** Throw from a handler to retry after a specific delay (e.g. honouring `Retry-After`). */
export class RetryLaterError extends Error {
  override name = 'RetryLaterError';
  constructor(
    message: string,
    readonly delayMs: number,
  ) {
    super(message);
  }
}

/** Throw from a handler when retrying cannot help; the job is dead-lettered immediately. */
export class PermanentFailureError extends Error {
  override name = 'PermanentFailureError';
}

export interface ConsumerOptions<T> {
  queue: string;
  handler: (job: Job<T>) => Promise<void>;
  /** Max jobs processed concurrently by this consumer. */
  concurrency?: number;
  /** Must comfortably exceed the handler's worst-case runtime. */
  leaseMs?: number;
  /** Idle polling backs off exponentially between these bounds. */
  minPollMs?: number;
  maxPollMs?: number;
  /** How often this consumer sweeps expired leases. */
  reclaimIntervalMs?: number;
  backoff?: BackoffPolicy;
  workerId?: string;
  onEvent?: (event: ConsumerEvent) => void;
}

export type ConsumerEvent =
  | { type: 'completed'; job: Job; durationMs: number }
  | { type: 'retry_scheduled'; job: Job; delayMs: number; error: unknown }
  | { type: 'dead_lettered'; job: Job; error: unknown }
  | { type: 'lease_lost'; job: Job }
  | { type: 'reclaimed'; count: number }
  | { type: 'poll_error'; error: unknown };

/**
 * Pull-based worker loop on top of any `QueueTransport`.
 *
 * - Keeps up to `concurrency` jobs in flight, fetching only free slots.
 * - Polls immediately while there is work; backs off exponentially when idle
 *   to avoid hammering the database (important on serverless Postgres).
 * - `stop()` stops fetching and waits for in-flight jobs to finish
 *   (graceful shutdown on SIGTERM during deploys).
 */
export class Consumer<T = unknown> {
  private readonly opts: Required<Omit<ConsumerOptions<T>, 'onEvent'>> &
    Pick<ConsumerOptions<T>, 'onEvent'>;
  private running = false;
  private loop: Promise<void> | null = null;
  private readonly inFlight = new Set<Promise<void>>();
  private wake: (() => void) | null = null;

  constructor(
    private readonly transport: QueueTransport,
    options: ConsumerOptions<T>,
  ) {
    this.opts = {
      concurrency: 10,
      leaseMs: 30_000,
      minPollMs: 50,
      maxPollMs: 2_000,
      reclaimIntervalMs: 15_000,
      backoff: DEFAULT_BACKOFF,
      workerId: `${hostname()}:${process.pid}`,
      ...options,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    await Promise.allSettled([...this.inFlight]);
  }

  private async run(): Promise<void> {
    let idleDelay = this.opts.minPollMs;
    let lastReclaim = 0;

    while (this.running) {
      try {
        if (Date.now() - lastReclaim >= this.opts.reclaimIntervalMs) {
          lastReclaim = Date.now();
          const count = await this.transport.reclaimExpired();
          if (count > 0) this.emit({ type: 'reclaimed', count });
        }

        const free = this.opts.concurrency - this.inFlight.size;
        const jobs =
          free > 0
            ? await this.transport.dequeue<T>(this.opts.queue, {
                limit: free,
                leaseMs: this.opts.leaseMs,
                workerId: this.opts.workerId,
              })
            : [];

        for (const job of jobs) this.track(this.process(job));

        if (jobs.length > 0) {
          idleDelay = this.opts.minPollMs;
          continue;
        }
        await this.idle(free > 0 ? idleDelay : this.opts.minPollMs);
        if (free > 0) idleDelay = Math.min(idleDelay * 2, this.opts.maxPollMs);
      } catch (error) {
        this.emit({ type: 'poll_error', error });
        await this.idle(this.opts.maxPollMs);
      }
    }
  }

  private track(p: Promise<void>): void {
    this.inFlight.add(p);
    void p.finally(() => {
      this.inFlight.delete(p);
      this.wake?.(); // a slot freed up — poll again right away
    });
  }

  private idle(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    }).then(() => {
      this.wake = null;
    });
  }

  private async process(job: Job<T>): Promise<void> {
    const started = performance.now();
    try {
      await this.opts.handler(job);
      const ok = await this.transport.ack(job);
      if (ok) {
        this.emit({ type: 'completed', job, durationMs: performance.now() - started });
      } else {
        this.emit({ type: 'lease_lost', job });
      }
    } catch (error) {
      await this.handleFailure(job, error).catch((e: unknown) =>
        this.emit({ type: 'poll_error', error: e }),
      );
    }
  }

  private async handleFailure(job: Job<T>, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof PermanentFailureError) {
      const ok = await this.transport.fail(job, message);
      this.emit(ok ? { type: 'dead_lettered', job, error } : { type: 'lease_lost', job });
      return;
    }

    const delayMs =
      error instanceof RetryLaterError
        ? error.delayMs
        : (nextRetryDelay(job.attempts, this.opts.backoff) ?? 0);

    const outcome = await this.transport.retry(job, { delayMs, error: message });
    if (outcome === 'scheduled') this.emit({ type: 'retry_scheduled', job, delayMs, error });
    else if (outcome === 'dead') this.emit({ type: 'dead_lettered', job, error });
    else this.emit({ type: 'lease_lost', job });
  }

  private emit(event: ConsumerEvent): void {
    this.opts.onEvent?.(event);
  }
}
