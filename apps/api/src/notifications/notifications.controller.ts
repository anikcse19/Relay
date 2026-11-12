import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { pageSchema, paginationQueryDocs } from '../common/pagination.js';
import { openApiSchema } from '../common/zod-openapi.js';
import {
  CurrentTenant,
  ENVIRONMENT_SCOPED,
  type Tenant,
  TenantGuard,
} from '../tenancy/tenant.guard.js';
import {
  listNotificationsSchema,
  markReadSchema,
  NotificationsService,
} from './notifications.service.js';

const notificationSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'ntf_01JD3X8Z5K2M4N6P8Q0R2S4T6V' },
    kind: { type: 'string', enum: ['endpoint_failing', 'endpoint_disabled', 'endpoint_recovered'] },
    title: { type: 'string' },
    body: { type: 'string' },
    endpointId: { type: 'string', nullable: true, description: 'null if the endpoint was deleted' },
    endpointUrl: { type: 'string' },
    readAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const listSchema: SchemaObject = {
  ...pageSchema(notificationSchema),
  properties: {
    ...pageSchema(notificationSchema).properties,
    unreadCount: { type: 'integer' },
  },
};

/** Endpoint health alerts: circuit opened, auto-disabled, recovered. */
@ApiTags('Notifications')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller(['v1/notifications', `${ENVIRONMENT_SCOPED}/notifications`])
@UseGuards(TenantGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications, newest first, with the unread count' })
  @ApiQuery(paginationQueryDocs[0])
  @ApiQuery(paginationQueryDocs[1])
  @ApiQuery({ name: 'unread', required: false, enum: ['true', 'false'] })
  @ApiOkResponse({ schema: listSchema })
  list(@CurrentTenant() tenant: Tenant, @Query() query: unknown) {
    return this.service.list(tenant, listNotificationsSchema.parse(query));
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notifications read (all of them when `ids` is omitted)' })
  @ApiBody({ schema: openApiSchema(markReadSchema) })
  @ApiOkResponse({ schema: { type: 'object', properties: { updated: { type: 'integer' } } } })
  markRead(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    return this.service.markRead(tenant, markReadSchema.parse(body ?? {}).ids);
  }
}
