import { isDeepStrictEqual } from 'node:util';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  count,
  type Database,
  deliveries,
  desc,
  endpoints,
  eq,
  events,
  gte,
  inArray,
  isNull,
  lt,
  notifyJobs,
  or,
  publish,
  queueJobs,
  sql,
} from '@relay/db';
import { type DeliveryJobPayload, idAt, newId, QUEUES } from '@relay/shared';
import { type Page, toPage } from '../common/pagination.js';
import { DB } from '../database/database.module.js';
import type { Tenant } from '../tenancy/tenant.guard.js';
import type { CreateEventInput, ListEventsQuery } from './events.schema.js';

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
    tenant: Pick<Tenant, 'organizationId' | 'environmentId'>,
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

      if (subscribed.length === 0) {
        await announce(tx, created, 0);
        return { event: created, replayed: false, deliveryCount: 0 };
      }

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
        // Wakes idle workers now instead of on their next poll (ADR-0016).
        await notifyJobs(tx, QUEUES.delivery);
      }

      await announce(tx, created, rows.length);
      return { event: created, replayed: false, deliveryCount: rows.length };
    });
  }

  /**
   * Lists events newest first, each with a count of its deliveries per
   * status. Payloads are left out to keep pages small; fetch one event for it.
   */
  async list(
    tenant: Tenant,
    query: Omit<ListEventsQuery, 'limit'> & { limit: number },
  ): Promise<Page<EventSummary>> {
    // Ids are time-sortable, so a time range is a range on the (environment_id, id) index.
    const byDelivery =
      query.endpointId || query.status
        ? sql`exists (select 1 from ${deliveries}
                       where ${deliveries.eventId} = ${events.id}
                       ${query.endpointId ? sql`and ${deliveries.endpointId} = ${query.endpointId}` : sql``}
                       ${query.status ? sql`and ${deliveries.status} = ${query.status}` : sql``})`
        : undefined;
    const rows = await this.db
      .select({ id: events.id, type: events.eventType, createdAt: events.createdAt })
      .from(events)
      .where(
        and(
          eq(events.environmentId, tenant.environmentId),
          query.type ? eq(events.eventType, query.type) : undefined,
          query.from ? gte(events.id, idAt('event', Date.parse(query.from))) : undefined,
          query.to ? lt(events.id, idAt('event', Date.parse(query.to))) : undefined,
          byDelivery,
          query.cursor ? lt(events.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(events.id))
      .limit(query.limit + 1);
    const page = toPage(rows, query.limit);

    // One grouped query for the whole page, not one per event.
    const counts = page.data.length
      ? await this.db
          .select({ eventId: deliveries.eventId, status: deliveries.status, n: count() })
          .from(deliveries)
          .where(
            inArray(
              deliveries.eventId,
              page.data.map((e) => e.id),
            ),
          )
          .groupBy(deliveries.eventId, deliveries.status)
      : [];

    return {
      ...page,
      data: page.data.map((event) => {
        const deliveryCounts = emptyCounts();
        for (const c of counts) if (c.eventId === event.id) deliveryCounts[c.status] = c.n;
        return { ...event, deliveryCounts };
      }),
    };
  }

  /** One event with its payload and a row per endpoint it was sent to. */
  async get(tenant: Tenant, id: string) {
    const [event] = await this.db
      .select({
        id: events.id,
        type: events.eventType,
        data: events.payload,
        idempotencyKey: events.idempotencyKey,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(and(eq(events.id, id), eq(events.environmentId, tenant.environmentId)))
      .limit(1);
    if (!event) throw new NotFoundException('Event not found.');

    const sent = await this.db
      .select({
        id: deliveries.id,
        endpointId: deliveries.endpointId,
        endpointUrl: endpoints.url,
        status: deliveries.status,
        attemptCount: deliveries.attemptCount,
        lastStatusCode: deliveries.lastStatusCode,
        lastAttemptAt: deliveries.lastAttemptAt,
        nextAttemptAt: deliveries.nextAttemptAt,
      })
      .from(deliveries)
      .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
      .where(eq(deliveries.eventId, event.id))
      .orderBy(asc(deliveries.id));

    return { ...event, deliveries: sent };
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Live "new event" message, delivered to dashboards when the ingest transaction commits. */
function announce(tx: Tx, event: typeof events.$inferSelect, pending: number) {
  return publish(tx, {
    type: 'event.created',
    environmentId: event.environmentId,
    event: {
      id: event.id,
      type: event.eventType,
      createdAt: event.createdAt.toISOString(),
      deliveryCounts: { ...emptyCounts(), pending },
    },
  });
}

type DeliveryStatus = (typeof deliveries.$inferSelect)['status'];

export interface EventSummary {
  id: string;
  type: string;
  createdAt: Date;
  deliveryCounts: Record<DeliveryStatus, number>;
}

function emptyCounts(): Record<DeliveryStatus, number> {
  return { pending: 0, retrying: 0, succeeded: 0, failed: 0, cancelled: 0 };
}
