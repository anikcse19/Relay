import { Controller, Get, Inject, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  CurrentTenant,
  ENVIRONMENT_SCOPED,
  type Tenant,
  TenantGuard,
} from '../tenancy/tenant.guard.js';
import { LiveHub } from './live-hub.js';

/** Comment line every 20 s: keeps proxies and load balancers from closing an idle stream. */
const HEARTBEAT_MS = 20_000;
/** Tells EventSource how long to wait before reconnecting. */
const RETRY_MS = 3_000;

@ApiTags('Live')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller(['v1/stream', `${ENVIRONMENT_SCOPED}/stream`])
@UseGuards(TenantGuard)
export class LiveController {
  constructor(@Inject(LiveHub) private readonly hub: LiveHub) {}

  @Get()
  @ApiOperation({
    summary: 'Live stream of changes (Server-Sent Events)',
    description:
      'A `text/event-stream` of `event.created`, `delivery.updated` and `notification.created` ' +
      'messages for this environment (ids and small facts; fetch details from the REST API). ' +
      'A `resync` event means messages may have been missed: refetch what you display. ' +
      'Messages are not replayed after a disconnect.',
  })
  @ApiOkResponse({
    description: 'An open `text/event-stream`',
    content: { 'text/event-stream': {} },
  })
  async stream(
    @CurrentTenant() tenant: Tenant,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Subscribe before writing headers: if LISTEN can't start, the client gets
    // a normal problem+json error (and EventSource retries) instead of an empty stream.
    const pending: string[] = [];
    let raw: FastifyReply['raw'] | null = null;
    const write = (chunk: string) => (raw ? raw.write(chunk) : pending.push(chunk));
    const unsubscribe = await this.hub.subscribe(tenant.environmentId, (event, data) =>
      write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );

    reply.hijack(); // we own the socket from here; Fastify won't send a reply
    raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      // no-transform: stop any proxy from compressing/buffering the stream.
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-request-id': String(request.id),
    });
    raw.write(`retry: ${RETRY_MS}\n\n`);
    raw.write(`event: ready\ndata: {}\n\n`);
    for (const chunk of pending.splice(0)) raw.write(chunk);

    const heartbeat = setInterval(() => raw?.write(': ping\n\n'), HEARTBEAT_MS);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
