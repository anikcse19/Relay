import { isDeepStrictEqual } from 'node:util';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  and,
  type Database,
  deliveries,
  endpoints,
  eq,
  events,
  isNull,
  or,
  queueJobs,
  sql,
} from '@relay/db';
import { type DeliveryJobPayload, newId, QUEUES } from '@relay/shared';
import type { ApiKeyContext } from '../api-keys/api-key.guard.js';
import { DB } from '../database/database.module.js';
import type { CreateEventInput } from './events.schema.js';

export interface IngestResult {
  event: typeof events.$inferSelect;
  /** True when an earlier request with the same Idempotency-Key created the event. */
  replayed: boolean;
  /** Deliveries created by this request (0 on replay). */
  deliveryCount: number;
}

@Injectable()
export class EventsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Stores an event and fans it out in ONE transaction: the event row, one
   * `deliveries` row per subscribed endpoint, and one queue job per delivery.
   *
   * Because the queue lives in Postgres (ADR-0002/0004), there's no dual write:
   * either all of it commits (and every delivery will be attempted) or none of
   * it does (and the producer gets an error and retries). Nothing in between
   * can lose an event, so no separate outbox relay is needed.
   */
  async ingest(
    tenant: ApiKeyContext,
    input: CreateEventInput,
    idempotencyKey?: string,
  ): Promise<IngestResult> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(events)
        .values({
          id: newId('event'),
          organizationId: tenant.organizationId,
          environmentId: tenant.environmentId,
          eventType: input.type,
          payload: input.data,
          idempotencyKey: idempotencyKey ?? null,
        })
        // A concurrent request with the same key blocks here until the other
        // transaction finishes, then falls through to the replay path below.
        .onConflictDoNothing({ target: [events.environmentId, events.idempotencyKey] })
        .returning();

      if (!created) {
        const [original] = await tx
          .select()
          .from(events)
          .where(
            and(
              eq(events.environmentId, tenant.environmentId),
              eq(events.idempotencyKey, idempotencyKey!),
            ),
          )
          .limit(1);
        if (
          !original ||
          original.eventType !== input.type ||
          !isDeepStrictEqual(original.payload, input.data)
        ) {
          throw new ConflictException(
            'This Idempotency-Key was already used with a different request body.',
          );
        }
        return { event: original, replayed: true, deliveryCount: 0 };
      }

      const subscribed = await tx
        .select({ id: endpoints.id })
        .from(endpoints)
        .where(
          and(
            eq(endpoints.environmentId, tenant.environmentId),
            eq(endpoints.status, 'active'),
            or(
              isNull(endpoints.filterEventTypes),
              sql`${input.type} = any(${endpoints.filterEventTypes})`,
            ),
          ),
        );

      if (subscribed.length === 0) return { event: created, replayed: false, deliveryCount: 0 };

      const now = new Date();
      const rows = await tx
        .insert(deliveries)
        .values(
          subscribed.map((endpoint) => ({
            id: newId('delivery'),
            organizationId: tenant.organizationId,
            environmentId: tenant.environmentId,
            eventId: created.id,
            endpointId: endpoint.id,
            nextAttemptAt: now,
          })),
        )
        .onConflictDoNothing() // (event_id, endpoint_id) is unique: fan-out is re-runnable
        .returning({ id: deliveries.id });

      if (rows.length > 0) {
        await tx
          .insert(queueJobs)
          .values(
            rows.map((delivery) => ({
              queue: QUEUES.delivery,
              payload: { deliveryId: delivery.id } satisfies DeliveryJobPayload,
              dedupeKey: delivery.id,
            })),
          )
          .onConflictDoNothing();
      }

      return { event: created, replayed: false, deliveryCount: rows.length };
    });
  }
}
