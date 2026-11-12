import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  type Database,
  deliveries,
  desc,
  endpoints,
  eq,
  inArray,
  lt,
  queueJobs,
  sql,
} from '@relay/db';
import { generateSigningSecret, newId, QUEUES, SECRET_ROTATION_GRACE_HOURS } from '@relay/shared';
import { ZodError } from 'zod';
import { type Page, toPage } from '../common/pagination.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Tenant } from '../tenancy/tenant.guard.js';
import type { CreateEndpointInput, UpdateEndpointInput } from './endpoints.schema.js';
import { checkEndpointUrl, EndpointUrlError, type UrlPolicy, urlPolicyFor } from './url-policy.js';

type EndpointRow = typeof endpoints.$inferSelect;

/** What the API returns. Secrets and custom header values never leave the server. */
export interface PublicEndpoint {
  id: string;
  url: string;
  description: string | null;
  status: EndpointRow['status'];
  disabledReason: string | null;
  filterEventTypes: string[] | null;
  headerNames: string[];
  secretRotatedAt: Date | null;
  /** Until then, deliveries are also signed with the previous secret. */
  previousSecretExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicEndpoint(row: EndpointRow, now = Date.now()): PublicEndpoint {
  const graceEnds =
    row.previousSigningSecret && row.secretRotatedAt
      ? new Date(row.secretRotatedAt.getTime() + SECRET_ROTATION_GRACE_HOURS * 3_600_000)
      : null;
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    status: row.status,
    disabledReason: row.disabledReason,
    filterEventTypes: row.filterEventTypes,
    headerNames: Object.keys(row.headers).sort(),
    secretRotatedAt: row.secretRotatedAt,
    previousSecretExpiresAt: graceEnds && graceEnds.getTime() > now ? graceEnds : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class EndpointsService {
  private readonly policy: UrlPolicy;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) env: Env,
  ) {
    this.policy = urlPolicyFor(env);
  }

  async list(
    tenant: Tenant,
    query: { limit: number; cursor?: string },
  ): Promise<Page<PublicEndpoint>> {
    const rows = await this.db
      .select()
      .from(endpoints)
      .where(
        and(
          eq(endpoints.environmentId, tenant.environmentId),
          query.cursor ? lt(endpoints.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(endpoints.id))
      .limit(query.limit + 1);
    const now = Date.now();
    const page = toPage(rows, query.limit);
    return { ...page, data: page.data.map((row) => toPublicEndpoint(row, now)) };
  }

  async get(tenant: Tenant, id: string): Promise<PublicEndpoint> {
    return toPublicEndpoint(await this.find(tenant, id));
  }

  /** Creates an endpoint. The signing secret is returned here and on rotation, never again. */
  async create(
    tenant: Tenant,
    input: CreateEndpointInput,
  ): Promise<PublicEndpoint & { signingSecret: string }> {
    const url = await this.checkUrl(input.url);
    const signingSecret = generateSigningSecret();
    const [row] = await this.db
      .insert(endpoints)
      .values({
        id: newId('endpoint'),
        organizationId: tenant.organizationId,
        environmentId: tenant.environmentId,
        url,
        description: input.description ?? null,
        filterEventTypes: input.filterEventTypes ?? null,
        headers: input.headers ?? {},
        signingSecret,
      })
      .returning();
    return { ...toPublicEndpoint(row!), signingSecret };
  }

  async update(tenant: Tenant, id: string, input: UpdateEndpointInput): Promise<PublicEndpoint> {
    const url = input.url === undefined ? undefined : await this.checkUrl(input.url);

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: endpoints.status })
        .from(endpoints)
        .where(this.scoped(tenant, id))
        .for('update')
        .limit(1);
      if (!current) throw notFound();

      const [row] = await tx
        .update(endpoints)
        .set({
          ...(url !== undefined && { url }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.filterEventTypes !== undefined && { filterEventTypes: input.filterEventTypes }),
          ...(input.headers !== undefined && { headers: input.headers }),
          ...(input.status !== undefined && {
            status: input.status,
            // A manual change of state supersedes the reason the system disabled it.
            disabledReason: null,
          }),
        })
        .where(eq(endpoints.id, id))
        .returning();

      // The worker acks jobs for paused endpoints and leaves their deliveries
      // pending (it never drops them). Resuming re-queues them, so held
      // deliveries go out in the same order they would have.
      if (input.status === 'active' && current.status !== 'active') {
        await tx.execute(sql`
          insert into ${queueJobs} (queue, payload, dedupe_key)
          select ${QUEUES.delivery},
                 jsonb_build_object('deliveryId', ${deliveries.id}),
                 ${deliveries.id}
          from ${deliveries}
          where ${deliveries.endpointId} = ${id}
            and ${inArray(deliveries.status, ['pending', 'retrying'])}
          order by ${deliveries.id}
          on conflict do nothing
        `);
      }
      return toPublicEndpoint(row!);
    });
  }

  /** Deletes the endpoint and (by cascade) its delivery history; queued jobs become no-ops. */
  async remove(tenant: Tenant, id: string): Promise<void> {
    const deleted = await this.db
      .delete(endpoints)
      .where(this.scoped(tenant, id))
      .returning({ id: endpoints.id });
    if (deleted.length === 0) throw notFound();
  }

  /**
   * Issues a new signing secret. The old one keeps signing deliveries
   * (alongside the new one) for the grace period, so the receiver can
   * switch over with zero failed verifications.
   */
  async rotateSecret(
    tenant: Tenant,
    id: string,
  ): Promise<PublicEndpoint & { signingSecret: string }> {
    const signingSecret = generateSigningSecret();
    const [row] = await this.db
      .update(endpoints)
      .set({
        // Evaluated by Postgres against the row's current value, so two
        // concurrent rotations can't both demote the same secret.
        previousSigningSecret: sql`${endpoints.signingSecret}`,
        signingSecret,
        secretRotatedAt: sql`now()`,
      })
      .where(this.scoped(tenant, id))
      .returning();
    if (!row) throw notFound();
    return { ...toPublicEndpoint(row), signingSecret };
  }

  private async find(tenant: Tenant, id: string): Promise<EndpointRow> {
    const [row] = await this.db.select().from(endpoints).where(this.scoped(tenant, id)).limit(1);
    if (!row) throw notFound();
    return row;
  }

  private scoped(tenant: Tenant, id: string) {
    return and(eq(endpoints.id, id), eq(endpoints.environmentId, tenant.environmentId));
  }

  private async checkUrl(url: string): Promise<string> {
    try {
      return await checkEndpointUrl(url, this.policy);
    } catch (error) {
      if (error instanceof EndpointUrlError) {
        // Same shape as schema validation, so clients show it on the URL field.
        throw new ZodError([{ code: 'custom', path: ['url'], message: error.message, input: url }]);
      }
      throw error;
    }
  }
}

function notFound(): NotFoundException {
  return new NotFoundException('Endpoint not found.');
}
