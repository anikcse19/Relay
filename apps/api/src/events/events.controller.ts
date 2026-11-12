import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { pageSchema, paginationQueryDocs } from '../common/pagination.js';
import { openApiSchema } from '../common/zod-openapi.js';
import {
  CurrentTenant,
  ENVIRONMENT_SCOPED,
  RequireRoles,
  type Tenant,
  TenantGuard,
} from '../tenancy/tenant.guard.js';
import { createEventSchema, IDEMPOTENCY_KEY_PATTERN, listEventsSchema } from './events.schema.js';
import { EventsService } from './events.service.js';

const statusCounts = {
  type: 'object',
  properties: Object.fromEntries(
    ['pending', 'retrying', 'succeeded', 'failed', 'cancelled'].map((s) => [
      s,
      { type: 'integer' },
    ]),
  ),
} as const;

const eventSummarySchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'evt_01JD3X8Z5K2M4N6P8Q0R2S4T6V' },
    type: { type: 'string', example: 'invoice.paid' },
    createdAt: { type: 'string', format: 'date-time' },
    deliveryCounts: statusCounts,
  },
};

const eventDetailSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string' },
    data: { type: 'object' },
    idempotencyKey: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    deliveries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          endpointId: { type: 'string' },
          endpointUrl: { type: 'string' },
          status: { type: 'string' },
          attemptCount: { type: 'integer' },
          lastStatusCode: { type: 'integer', nullable: true },
          lastAttemptAt: { type: 'string', format: 'date-time', nullable: true },
          nextAttemptAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
  },
};

@ApiTags('Events')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller(['v1/events', `${ENVIRONMENT_SCOPED}/events`])
@UseGuards(TenantGuard)
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  @Post()
  @RequireRoles('owner', 'admin')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send an event',
    description:
      'Stores the event and schedules a delivery to every active endpoint subscribed to its ' +
      'type. A `202` means the event is durably stored: it will be delivered or dead-lettered, ' +
      'never silently dropped.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Makes retries safe: repeating a request with the same key returns the original event ' +
      '(with `Idempotent-Replayed: true`) instead of sending it twice.',
  })
  @ApiBody({ schema: openApiSchema(createEventSchema) })
  @ApiAcceptedResponse({
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'evt_01JD3X8Z5K2M4N6P8Q0R2S4T6V' },
        type: { type: 'string', example: 'invoice.paid' },
        data: { type: 'object' },
        idempotencyKey: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing, invalid, revoked or expired API key' })
  @ApiForbiddenResponse({ description: 'Dashboard users need the owner or admin role' })
  @ApiConflictResponse({ description: 'Idempotency-Key reused with a different body' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid event' })
  async create(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must be 1–255 printable ASCII characters.');
    }
    const input = createEventSchema.parse(body);
    const { event, replayed } = await this.events.ingest(tenant, input, idempotencyKey);

    if (replayed) void reply.header('idempotent-replayed', 'true');
    return {
      id: event.id,
      type: event.eventType,
      data: event.payload,
      idempotencyKey: event.idempotencyKey,
      createdAt: event.createdAt,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List events, newest first, with delivery counts per status' })
  @ApiQuery(paginationQueryDocs[0])
  @ApiQuery(paginationQueryDocs[1])
  @ApiQuery({ name: 'type', required: false, description: 'Only events of this exact type' })
  @ApiQuery({ name: 'from', required: false, description: 'Created at or after (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'Created before (ISO 8601)' })
  @ApiQuery({
    name: 'endpointId',
    required: false,
    description: 'Only events delivered to this endpoint',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'retrying', 'succeeded', 'failed', 'cancelled'],
    description: 'Only events with a delivery in this status (to `endpointId`, if given)',
  })
  @ApiOkResponse({ schema: pageSchema(eventSummarySchema) })
  list(@CurrentTenant() tenant: Tenant, @Query() query: unknown) {
    return this.events.list(tenant, listEventsSchema.parse(query));
  }

  @Get(':eventId')
  @ApiOperation({ summary: 'Get an event with its payload and deliveries' })
  @ApiOkResponse({ schema: eventDetailSchema })
  @ApiNotFoundResponse({ description: 'Event not found' })
  get(@CurrentTenant() tenant: Tenant, @Param('eventId') id: string) {
    return this.events.get(tenant, id);
  }
}
