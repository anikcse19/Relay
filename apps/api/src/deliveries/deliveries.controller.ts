import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { pageSchema, paginationQueryDocs } from '../common/pagination.js';
import {
  CurrentTenant,
  ENVIRONMENT_SCOPED,
  RequireRoles,
  type Tenant,
  TenantGuard,
} from '../tenancy/tenant.guard.js';
import {
  DELIVERY_STATUSES,
  DeliveriesService,
  listDeliveriesSchema,
} from './deliveries.service.js';

const nullableDate = { type: 'string', format: 'date-time', nullable: true } as const;
const headerMap = { type: 'object', additionalProperties: { type: 'string' }, nullable: true };

const summaryFields = {
  id: { type: 'string', example: 'dlv_01JD3X8Z5K2M4N6P8Q0R2S4T6V' },
  eventId: { type: 'string' },
  eventType: { type: 'string' },
  endpointId: { type: 'string' },
  endpointUrl: { type: 'string' },
  status: { type: 'string', enum: [...DELIVERY_STATUSES] },
  attemptCount: { type: 'integer' },
  lastStatusCode: { type: 'integer', nullable: true },
  lastAttemptAt: nullableDate,
  nextAttemptAt: nullableDate,
  createdAt: { type: 'string', format: 'date-time' },
} satisfies Record<string, SchemaObject>;

const detailSchema: SchemaObject = {
  type: 'object',
  properties: {
    ...summaryFields,
    requestBody: { type: 'string', description: 'The exact JSON body sent to the endpoint' },
    attempts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          attemptNumber: { type: 'integer' },
          trigger: { type: 'string', enum: ['scheduled', 'manual'] },
          statusCode: { type: 'integer', nullable: true },
          durationMs: { type: 'integer' },
          errorCode: {
            type: 'string',
            nullable: true,
            description: 'timeout | dns | connection_refused | tls | http_error | …',
          },
          errorMessage: { type: 'string', nullable: true },
          requestHeaders: { ...headerMap, description: 'Custom header values are redacted' },
          responseHeaders: headerMap,
          responseBody: { type: 'string', nullable: true, description: 'First few KB' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

/** Delivery log: one row per (event × endpoint), with every HTTP attempt. */
@ApiTags('Deliveries')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller(['v1/deliveries', `${ENVIRONMENT_SCOPED}/deliveries`])
@UseGuards(TenantGuard)
export class DeliveriesController {
  constructor(@Inject(DeliveriesService) private readonly deliveries: DeliveriesService) {}

  @Get()
  @ApiOperation({ summary: 'List deliveries, newest first' })
  @ApiQuery(paginationQueryDocs[0])
  @ApiQuery(paginationQueryDocs[1])
  @ApiQuery({ name: 'status', required: false, enum: DELIVERY_STATUSES })
  @ApiQuery({ name: 'endpointId', required: false })
  @ApiQuery({ name: 'eventId', required: false })
  @ApiOkResponse({ schema: pageSchema({ type: 'object', properties: summaryFields }) })
  list(@CurrentTenant() tenant: Tenant, @Query() query: unknown) {
    return this.deliveries.list(tenant, listDeliveriesSchema.parse(query));
  }

  @Get(':deliveryId')
  @ApiOperation({ summary: 'Get a delivery with the request body and every attempt' })
  @ApiOkResponse({ schema: detailSchema })
  @ApiNotFoundResponse({ description: 'Delivery not found' })
  get(@CurrentTenant() tenant: Tenant, @Param('deliveryId') id: string) {
    return this.deliveries.get(tenant, id);
  }

  @Post(':deliveryId/replay')
  @RequireRoles('owner', 'admin')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Replay a delivery',
    description:
      'Sends a finished delivery (failed, succeeded or cancelled) again: one new attempt, ' +
      'recorded with `trigger: "manual"`, and no automatic retries if it fails. The receiver ' +
      'gets the same `webhook-id`, so idempotent receivers handle it safely.',
  })
  @ApiAcceptedResponse({ schema: detailSchema })
  @ApiForbiddenResponse({ description: 'Dashboard users need the owner or admin role' })
  @ApiConflictResponse({ description: 'Already scheduled, or the endpoint is paused/disabled' })
  @ApiNotFoundResponse({ description: 'Delivery not found' })
  replay(@CurrentTenant() tenant: Tenant, @Param('deliveryId') id: string) {
    return this.deliveries.replay(tenant, id);
  }
}
