import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, apiKeys, type Database, eq, gt, isNull, lt, or, sql } from '@relay/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DB } from '../database/database.module.js';
import { hashApiKey, parseBearerKey } from './api-key.js';

/** The tenant an API request acts as, resolved from its key. */
export interface ApiKeyContext {
  apiKeyId: string;
  organizationId: string;
  environmentId: string;
}

type RequestWithKey = FastifyRequest & { apiKey?: ApiKeyContext };

/** `last_used_at` is refreshed at most this often per key, not on every request. */
const LAST_USED_RESOLUTION = sql`interval '1 minute'`;

/**
 * Authenticates `Authorization: Bearer rk_…` and scopes the request to the
 * key's organization + environment. Every failure reason (malformed, unknown,
 * revoked, expired) returns the same 401, so callers can't probe key state.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithKey>();

    const key = parseBearerKey(request.headers.authorization);
    const row = key ? await this.findActiveKey(hashApiKey(key)) : undefined;
    if (!row) {
      void http.getResponse<FastifyReply>().header('www-authenticate', 'Bearer realm="relay"');
      throw new UnauthorizedException('Missing, invalid, revoked or expired API key.');
    }

    // Conditional write: a hot key costs one UPDATE per minute, not per request.
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(apiKeys.id, row.id),
          or(
            isNull(apiKeys.lastUsedAt),
            lt(apiKeys.lastUsedAt, sql`now() - ${LAST_USED_RESOLUTION}`),
          ),
        ),
      );

    request.apiKey = {
      apiKeyId: row.id,
      organizationId: row.organizationId,
      environmentId: row.environmentId,
    };
    return true;
  }

  private async findActiveKey(keyHash: string) {
    const [row] = await this.db
      .select({
        id: apiKeys.id,
        organizationId: apiKeys.organizationId,
        environmentId: apiKeys.environmentId,
      })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.keyHash, keyHash),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, sql`now()`)),
        ),
      )
      .limit(1);
    return row;
  }
}

/** Injects the tenant context resolved by `ApiKeyGuard`. */
export const ApiKeyAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApiKeyContext => {
    const apiKey = context.switchToHttp().getRequest<RequestWithKey>().apiKey;
    if (!apiKey) throw new Error('ApiKeyAuth used on a route without ApiKeyGuard');
    return apiKey;
  },
);
