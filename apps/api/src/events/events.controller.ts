import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { type ApiKeyContext, ApiKeyAuth, ApiKeyGuard } from '../api-keys/api-key.guard.js';
import { openApiSchema } from '../common/zod-openapi.js';
import { createEventSchema, IDEMPOTENCY_KEY_PATTERN } from './events.schema.js';
import { EventsService } from './events.service.js';

@ApiTags('Events')
@ApiBearerAuth('apiKey')
@Controller('v1/events')
@UseGuards(ApiKeyGuard)
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  @Post()
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
  @ApiConflictResponse({ description: 'Idempotency-Key reused with a different body' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid event' })
  async create(
    @ApiKeyAuth() tenant: ApiKeyContext,
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
}
