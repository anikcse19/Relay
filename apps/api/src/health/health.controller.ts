import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import type { SqlExecutor } from '@relay/db';
import type { FastifyReply } from 'fastify';
import { SQL } from '../database/database.module.js';

const DB_CHECK_TIMEOUT_MS = 3_000;

type CheckResult = { status: 'up' | 'down'; latencyMs: number; error?: string };

const readinessSchema: SchemaObject = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'error'] },
    checks: {
      type: 'object',
      properties: {
        database: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['up', 'down'] },
            latencyMs: { type: 'number' },
            error: { type: 'string' },
          },
        },
      },
    },
  },
};

/**
 * Two probes, following the Kubernetes model:
 *  - liveness:  "is the process healthy?" — never touches dependencies, so a
 *               database outage doesn't cause the orchestrator to restart
 *               every pod (which would turn an outage into a crash loop).
 *  - readiness: "can this instance serve traffic?" — checks dependencies;
 *               failing it only removes the pod from the load balancer.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@Inject(SQL) private readonly sql: SqlExecutor) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({
    schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } },
  })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (checks database connectivity)' })
  @ApiOkResponse({ schema: readinessSchema })
  @ApiServiceUnavailableResponse({ schema: readinessSchema })
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const database = await this.checkDatabase();
    const healthy = database.status === 'up';
    reply.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: healthy ? 'ok' : 'error', checks: { database } };
  }

  private async checkDatabase(): Promise<CheckResult> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.sql.query('select 1'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), DB_CHECK_TIMEOUT_MS);
        }),
      ]);
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Math.round(performance.now() - started),
        // Deliberately generic: never leak connection strings or hostnames.
        error: error instanceof Error && error.message === 'timed out' ? 'timeout' : 'unreachable',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
