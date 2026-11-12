import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import {
  CurrentTenant,
  ENVIRONMENT_SCOPED,
  type Tenant,
  TenantGuard,
} from '../tenancy/tenant.guard.js';
import { AnalyticsService, analyticsQuerySchema } from './analytics.service.js';

const nullableMs = { type: 'integer', nullable: true } as const;
const statsProperties: Record<string, SchemaObject> = {
  attempts: { type: 'integer' },
  succeeded: { type: 'integer', description: 'Attempts that got a 2xx' },
  retried: { type: 'integer', description: 'Failed attempts that scheduled a retry' },
  failed: { type: 'integer', description: 'Failed attempts with no retry left' },
  successRate: { type: 'number', nullable: true, description: 'succeeded / attempts (0–1)' },
  p50: { ...nullableMs, description: 'Median latency (ms) of attempts that got a response' },
  p95: nullableMs,
  p99: nullableMs,
};

const analyticsSchema: SchemaObject = {
  type: 'object',
  properties: {
    range: { type: 'string', enum: ['24h', '7d', '30d'] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    bucketMs: { type: 'integer' },
    totals: { type: 'object', properties: statsProperties },
    series: {
      type: 'array',
      items: {
        type: 'object',
        properties: { start: { type: 'string', format: 'date-time' }, ...statsProperties },
      },
    },
    endpoints: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          endpointId: { type: 'string' },
          url: { type: 'string' },
          ...statsProperties,
        },
      },
    },
  },
};

/** Delivery success rate, outcomes and latency percentiles over time. */
@ApiTags('Analytics')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller(['v1/analytics', `${ENVIRONMENT_SCOPED}/analytics`])
@UseGuards(TenantGuard)
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly service: AnalyticsService) {}

  @Get()
  @ApiOperation({
    summary: 'Delivery analytics: totals, a time series and a per-endpoint breakdown',
  })
  @ApiQuery({ name: 'range', required: false, enum: ['24h', '7d', '30d'] })
  @ApiQuery({ name: 'endpointId', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ schema: analyticsSchema })
  get(@CurrentTenant() tenant: Tenant, @Query() query: unknown) {
    return this.service.get(tenant, analyticsQuerySchema.parse(query));
  }
}
