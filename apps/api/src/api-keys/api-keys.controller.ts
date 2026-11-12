import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { and, apiKeys, type Database, desc, eq } from '@relay/db';
import { newId } from '@relay/shared';
import { z } from 'zod';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession, SessionGuard } from '../auth/session.guard.js';
import { openApiSchema } from '../common/zod-openapi.js';
import { DB } from '../database/database.module.js';
import { requireEnvironment, type Role } from '../tenancy/environment-access.js';
import { generateApiKey, modeForEnvironment } from './api-key.js';

const MANAGE_ROLES: readonly Role[] = ['owner', 'admin'];

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100).describe('Label shown in the dashboard'),
  expiresAt: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('Optional expiry (ISO 8601). Omit for a key that never expires.')
    .refine((v) => v === undefined || new Date(v).getTime() > Date.now(), {
      message: 'must be in the future',
    }),
});

const apiKeyFields = {
  id: { type: 'string', example: 'key_01JD3X8Z5K2M4N6P8Q0R2S4T6V' },
  name: { type: 'string' },
  keyPrefix: { type: 'string', example: 'rk_test_a1B2c3' },
  environmentId: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' },
  lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
  expiresAt: { type: 'string', format: 'date-time', nullable: true },
  revokedAt: { type: 'string', format: 'date-time', nullable: true },
} satisfies Record<string, SchemaObject>;

const apiKeySchema: SchemaObject = { type: 'object', properties: apiKeyFields };
const createdKeySchema: SchemaObject = {
  type: 'object',
  properties: {
    ...apiKeyFields,
    key: {
      type: 'string',
      description: 'The full secret key. Returned only once: store it now.',
      example: 'rk_test_a1B2c3…',
    },
  },
};

const publicColumns = {
  id: apiKeys.id,
  name: apiKeys.name,
  keyPrefix: apiKeys.keyPrefix,
  environmentId: apiKeys.environmentId,
  createdAt: apiKeys.createdAt,
  lastUsedAt: apiKeys.lastUsedAt,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
};

/** Dashboard-facing key management (session auth). The hash never leaves the server. */
@ApiTags('API keys')
@ApiCookieAuth('session')
@Controller('v1/environments/:environmentId/api-keys')
@UseGuards(SessionGuard)
export class ApiKeysController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Post()
  @ApiOperation({ summary: 'Create an API key (owner/admin). The secret is shown once.' })
  @ApiBody({ schema: openApiSchema(createApiKeySchema) })
  @ApiCreatedResponse({ schema: createdKeySchema })
  @ApiForbiddenResponse({ description: 'Requires the owner or admin role' })
  @ApiNotFoundResponse({ description: 'Environment not found' })
  async create(
    @CurrentSession() { user }: AuthSession,
    @Param('environmentId') environmentId: string,
    @Body() body: unknown,
  ) {
    const env = await requireEnvironment(this.db, user.id, environmentId, MANAGE_ROLES);
    const input = createApiKeySchema.parse(body);
    const { key, keyPrefix, keyHash } = generateApiKey(modeForEnvironment(env.kind));

    const [row] = await this.db
      .insert(apiKeys)
      .values({
        id: newId('apiKey'),
        organizationId: env.organizationId,
        environmentId: env.id,
        name: input.name,
        keyPrefix,
        keyHash,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .returning(publicColumns);

    return { ...row, key };
  }

  @Get()
  @ApiOperation({ summary: 'List API keys (including revoked ones), newest first' })
  @ApiOkResponse({ schema: { type: 'array', items: apiKeySchema } })
  @ApiNotFoundResponse({ description: 'Environment not found' })
  async list(
    @CurrentSession() { user }: AuthSession,
    @Param('environmentId') environmentId: string,
  ) {
    const env = await requireEnvironment(this.db, user.id, environmentId);
    return this.db
      .select(publicColumns)
      .from(apiKeys)
      .where(eq(apiKeys.environmentId, env.id))
      .orderBy(desc(apiKeys.id)); // ids are time-sortable ULIDs
  }

  @Delete(':keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key (owner/admin). Takes effect immediately.' })
  @ApiNoContentResponse({ description: 'Revoked (idempotent)' })
  @ApiForbiddenResponse({ description: 'Requires the owner or admin role' })
  @ApiNotFoundResponse({ description: 'Environment or key not found' })
  async revoke(
    @CurrentSession() { user }: AuthSession,
    @Param('environmentId') environmentId: string,
    @Param('keyId') keyId: string,
  ): Promise<void> {
    const env = await requireEnvironment(this.db, user.id, environmentId, MANAGE_ROLES);
    const [key] = await this.db
      .select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.environmentId, env.id)))
      .limit(1);
    if (!key) throw new NotFoundException('API key not found.');
    if (key.revokedAt) return; // already revoked: keep the original timestamp

    await this.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, key.id));
  }
}
