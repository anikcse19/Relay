import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Logger } from 'pino';
import { AppModule, type AppModuleOptions } from './app.module.js';
import type { Auth } from './auth/auth.js';
import { registerAuthRoutes } from './auth/auth.routes.js';
import { AUTH } from './auth/auth.tokens.js';
import { loggerOptions, PinoNestLogger } from './common/logger.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { genRequestId, REQUEST_ID_HEADER } from './common/request-id.js';
import { setupOpenApi } from './openapi.js';

/**
 * Builds a fully configured (but not yet listening) application.
 * Shared by `main.ts` and the test suite, so tests exercise the exact same
 * pipeline as production: logging, request IDs, error format, OpenAPI.
 */
export async function createApp(options: AppModuleOptions): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: loggerOptions(options.env),
    genReqId: genRequestId,
    requestIdHeader: false, // handled by genReqId, which validates the incoming value
    trustProxy: true, // behind Vercel / load balancer: honour X-Forwarded-*
    bodyLimit: 512 * 1024, // event payloads are capped at 512 KB
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(options),
    adapter,
    {
      bufferLogs: true,
    },
  );

  const fastify = app.getHttpAdapter().getInstance();
  const log = fastify.log as unknown as Logger;

  app.useLogger(new PinoNestLogger(log));
  app.useGlobalFilters(new ProblemDetailsFilter(log));
  app.enableShutdownHooks();

  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  registerAuthRoutes(fastify, app.get<Auth>(AUTH));
  setupOpenApi(app);
  return app;
}
