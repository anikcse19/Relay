import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  type Database,
  deliveries,
  deliveryAttempts,
  desc,
  endpoints,
  eq,
  events,
  lt,
  notifyJobs,
  publish,
  queueJobs,
  sql,
} from '@relay/db';
import { type DeliveryJobPayload, QUEUES, webhookBody } from '@relay/shared';
import { z } from 'zod';
import { paginationSchema, toPage } from '../common/pagination.js';
import { DB } from '../database/database.module.js';
import type { Tenant } from '../tenancy/tenant.guard.js';

export const DELIVERY_STATUSES = [
  'pending',
  'retrying',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const listDeliveriesSchema = paginationSchema.extend({
  status: z.enum(DELIVERY_STATUSES).optional(),
  endpointId: z.string().max(64).optional(),
  eventId: z.string().max(64).optional(),
});

export type ListDeliveriesQuery = z.infer<typeof listDeliveriesSchema>;

const summaryColumns = {
  id: deliveries.id,
  eventId: deliveries.eventId,
  eventType: events.eventType,
  endpointId: deliveries.endpointId,
  endpointUrl: endpoints.url,
  status: deliveries.status,
  attemptCount: deliveries.attemptCount,
  lastStatusCode: deliveries.lastStatusCode,
  lastAttemptAt: deliveries.lastAttemptAt,
  nextAttemptAt: deliveries.nextAttemptAt,
  createdAt: deliveries.createdAt,
};

@Injectable()
export class DeliveriesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(tenant: Tenant, query: ListDeliveriesQuery) {
    const rows = await this.db
      .select(summaryColumns)
      .from(deliveries)
      .innerJoin(events, eq(events.id, deliveries.eventId))
      .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
      .where(
        and(
          eq(deliveries.environmentId, tenant.environmentId),
          query.status ? eq(deliveries.status, query.status) : undefined,
          query.endpointId ? eq(deliveries.endpointId, query.endpointId) : undefined,
          query.eventId ? eq(deliveries.eventId, query.eventId) : undefined,
          query.cursor ? lt(deliveries.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(deliveries.id))
      .limit(query.limit + 1);
    return toPage(rows, query.limit);
  }

  /**
   * Everything the delivery inspector shows: the delivery, the exact body
   * that was sent, and every attempt (oldest first) with its response.
   */
  async get(tenant: Tenant, id: string) {
    const [row] = await this.db
      .select({
        ...summaryColumns,
        payload: events.payload,
        eventCreatedAt: events.createdAt,
      })
      .from(deliveries)
      .innerJoin(events, eq(events.id, deliveries.eventId))
      .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
      .where(and(eq(deliveries.id, id), eq(deliveries.environmentId, tenant.environmentId)))
      .limit(1);
    if (!row) throw new NotFoundException('Delivery not found.');

    const attempts = await this.db
      .select({
        id: deliveryAttempts.id,
        attemptNumber: deliveryAttempts.attemptNumber,
        trigger: deliveryAttempts.trigger,
        statusCode: deliveryAttempts.statusCode,
        durationMs: deliveryAttempts.durationMs,
        errorCode: deliveryAttempts.errorCode,
        errorMessage: deliveryAttempts.errorMessage,
        requestHeaders: deliveryAttempts.requestHeaders,
        responseHeaders: deliveryAttempts.responseHeaders,
        responseBody: deliveryAttempts.responseBody,
        createdAt: deliveryAttempts.createdAt,
      })
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, row.id))
      .orderBy(asc(deliveryAttempts.attemptNumber));

    const { payload, eventCreatedAt, ...delivery } = row;
    return {
      ...delivery,
      // The body exactly as the worker sends it (same key order, same timestamp).
      requestBody: webhookBody({ type: row.eventType, createdAt: eventCreatedAt, data: payload }),
      attempts,
    };
  }

  /**
   * Manually re-sends a finished delivery (failed, succeeded or cancelled):
   * exactly one new attempt, recorded as `manual`, with no automatic
   * retries. The row is locked so two concurrent replays can't both queue.
   */
  async replay(tenant: Tenant, id: string) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          status: deliveries.status,
          endpointStatus: endpoints.status,
          eventId: deliveries.eventId,
          attemptCount: deliveries.attemptCount,
        })
        .from(deliveries)
        .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
        .where(and(eq(deliveries.id, id), eq(deliveries.environmentId, tenant.environmentId)))
        .for('update', { of: deliveries })
        .limit(1);
      if (!row) throw new NotFoundException('Delivery not found.');
      if (row.status === 'pending' || row.status === 'retrying') {
        throw new ConflictException(
          'This delivery is already scheduled; replay is for deliveries that have finished.',
        );
      }
      if (row.endpointStatus !== 'active') {
        throw new ConflictException(
          `The endpoint is ${row.endpointStatus}. Resume it first, then replay.`,
        );
      }

      await tx
        .update(deliveries)
        .set({ status: 'pending', nextAttemptAt: sql`now()` })
        .where(eq(deliveries.id, id));
      await tx
        .insert(queueJobs)
        .values({
          queue: QUEUES.delivery,
          payload: { deliveryId: id, trigger: 'manual' } satisfies DeliveryJobPayload,
          dedupeKey: id,
        })
        .onConflictDoNothing();
      await notifyJobs(tx, QUEUES.delivery);
      await publish(tx, {
        type: 'delivery.updated',
        environmentId: tenant.environmentId,
        deliveryId: id,
        eventId: row.eventId,
        from: row.status,
        to: 'pending',
        attemptCount: row.attemptCount,
      });
    });
    return this.get(tenant, id);
  }
}
