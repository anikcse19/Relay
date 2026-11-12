import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import { pageSchema, paginationQueryDocs } from '../common/pagination.js';
import { openApiSchema } from '../common/zod-openapi.js';
import {
  CurrentTenant,
  ENVIRONMENT_SCOPED,
  RequireRoles,
  type Tenant,
  TenantGuard,
} from '../tenancy/tenant.guard.js';
import {
  createEndpointSchema,
  listEndpointsSchema,
  updateEndpointSchema,
} from './endpoints.schema.js';
import { EndpointsService } from './endpoints.service.js';

const nullableDate = { type: 'string', format: 'date-time', nullable: true } as const;

const endpointFields = {
  id: { type: 'string', example: 'ep_01JD3X8Z5K2M4N6P8Q0R2S4T6V' },
  url: { type: 'string', example: 'https://example.com/webhooks' },
  description: { type: 'string', nullable: true },
  status: { type: 'string', enum: ['active', 'paused', 'disabled'] },
  disabledReason: { type: 'string', nullable: true },
  filterEventTypes: { type: 'array', items: { type: 'string' }, nullable: true },
  headerNames: { type: 'array', items: { type: 'string' } },
  secretRotatedAt: nullableDate,
  previousSecretExpiresAt: nullableDate,
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
} satisfies Record<string, SchemaObject>;

const endpointSchema: SchemaObject = { type: 'object', properties: endpointFields };
const withSecretSchema: SchemaObject = {
  type: 'object',
  properties: {
    ...endpointFields,
    signingSecret: {
      type: 'string',
      example: 'whsec_…',
      description: 'Verifies webhook signatures. Returned only once: store it now.',
    },
  },
};

const MANAGERS = ['owner', 'admin'] as const;

/**
 * Webhook endpoints. Each route answers at `/v1/endpoints` (API key) and at
 * `/v1/environments/:environmentId/endpoints` (dashboard session).
 */
@ApiTags('Endpoints')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller(['v1/endpoints', `${ENVIRONMENT_SCOPED}/endpoints`])
@UseGuards(TenantGuard)
export class EndpointsController {
  constructor(@Inject(EndpointsService) private readonly endpoints: EndpointsService) {}

  @Get()
  @ApiOperation({ summary: 'List endpoints, newest first' })
  @ApiQuery(paginationQueryDocs[0])
  @ApiQuery(paginationQueryDocs[1])
  @ApiOkResponse({ schema: pageSchema(endpointSchema) })
  list(@CurrentTenant() tenant: Tenant, @Query() query: unknown) {
    return this.endpoints.list(tenant, listEndpointsSchema.parse(query));
  }

  @Post()
  @RequireRoles(...MANAGERS)
  @ApiOperation({
    summary: 'Create an endpoint',
    description:
      'The response includes the signing secret, which is shown only once. In production, ' +
      'URLs must use https and resolve to public addresses.',
  })
  @ApiBody({ schema: openApiSchema(createEndpointSchema) })
  @ApiCreatedResponse({ schema: withSecretSchema })
  @ApiForbiddenResponse({ description: 'Requires the owner or admin role' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid or disallowed URL, or invalid fields' })
  create(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    return this.endpoints.create(tenant, createEndpointSchema.parse(body));
  }

  @Get(':endpointId')
  @ApiOperation({ summary: 'Get an endpoint' })
  @ApiOkResponse({ schema: endpointSchema })
  @ApiNotFoundResponse({ description: 'Endpoint not found' })
  get(@CurrentTenant() tenant: Tenant, @Param('endpointId') id: string) {
    return this.endpoints.get(tenant, id);
  }

  @Patch(':endpointId')
  @RequireRoles(...MANAGERS)
  @ApiOperation({
    summary: 'Update an endpoint',
    description:
      'Pausing holds new and pending deliveries; resuming sends them. `headers` replaces ' +
      'the whole set.',
  })
  @ApiBody({ schema: openApiSchema(updateEndpointSchema) })
  @ApiOkResponse({ schema: endpointSchema })
  @ApiNotFoundResponse({ description: 'Endpoint not found' })
  update(@CurrentTenant() tenant: Tenant, @Param('endpointId') id: string, @Body() body: unknown) {
    return this.endpoints.update(tenant, id, updateEndpointSchema.parse(body));
  }

  @Delete(':endpointId')
  @RequireRoles(...MANAGERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an endpoint',
    description: 'Also deletes its delivery history. Pending deliveries are not sent.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Endpoint not found' })
  async remove(@CurrentTenant() tenant: Tenant, @Param('endpointId') id: string): Promise<void> {
    await this.endpoints.remove(tenant, id);
  }

  @Post(':endpointId/rotate-secret')
  @RequireRoles(...MANAGERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the signing secret',
    description:
      'Returns the new secret (shown once). For the next 24 hours every delivery carries ' +
      'signatures from both the new and the previous secret, so receivers can switch ' +
      'without failing verification.',
  })
  @ApiOkResponse({ schema: withSecretSchema })
  @ApiNotFoundResponse({ description: 'Endpoint not found' })
  rotateSecret(@CurrentTenant() tenant: Tenant, @Param('endpointId') id: string) {
    return this.endpoints.rotateSecret(tenant, id);
  }
}
