import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  type Database,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notifications,
  sql,
} from '@relay/db';
import { z } from 'zod';
import { type Page, paginationSchema, toPage } from '../common/pagination.js';
import { DB } from '../database/database.module.js';
import type { Tenant } from '../tenancy/tenant.guard.js';

export const listNotificationsSchema = paginationSchema.extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true')
    .describe('Only unread notifications'),
});

export const markReadSchema = z.object({
  ids: z
    .array(z.string().max(64))
    .min(1)
    .max(100)
    .optional()
    .describe('Notifications to mark read. Omit to mark every notification read.'),
});

const columns = {
  id: notifications.id,
  kind: notifications.kind,
  title: notifications.title,
  body: notifications.body,
  endpointId: notifications.endpointId,
  endpointUrl: notifications.endpointUrl,
  readAt: notifications.readAt,
  createdAt: notifications.createdAt,
};

type Notification = { [K in keyof typeof columns]: (typeof columns)[K]['_']['data'] };

/** In-app alerts written by the worker (ADR-0015). Read state is per environment, shared by members. */
@Injectable()
export class NotificationsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(
    tenant: Tenant,
    query: z.infer<typeof listNotificationsSchema>,
  ): Promise<Page<Notification> & { unreadCount: number }> {
    const scope = eq(notifications.environmentId, tenant.environmentId);
    const [rows, [unread]] = await Promise.all([
      this.db
        .select(columns)
        .from(notifications)
        .where(
          and(
            scope,
            query.unread ? isNull(notifications.readAt) : undefined,
            query.cursor ? lt(notifications.id, query.cursor) : undefined,
          ),
        )
        .orderBy(desc(notifications.id))
        .limit(query.limit + 1),
      this.db
        .select({ n: count() })
        .from(notifications)
        .where(and(scope, isNull(notifications.readAt))),
    ]);
    return { ...toPage(rows as Notification[], query.limit), unreadCount: unread?.n ?? 0 };
  }

  /** Idempotent: already-read notifications keep their original read time. */
  async markRead(tenant: Tenant, ids?: string[]): Promise<{ updated: number }> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notifications.environmentId, tenant.environmentId),
          isNull(notifications.readAt),
          ids ? inArray(notifications.id, ids) : undefined,
        ),
      )
      .returning({ id: notifications.id });
    return { updated: updated.length };
  }
}
