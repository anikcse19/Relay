import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

const DESCRIPTION = `
Relay delivers webhooks reliably: send one event, and Relay fans it out to every
subscribed endpoint, signs it ([Standard Webhooks](https://www.standardwebhooks.com/)),
retries failures with exponential backoff, and records every attempt.

**Errors** use [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)
(\`application/problem+json\`). Every response carries an \`x-request-id\` header —
include it when contacting support.
`.trim();

/**
 * Serves the OpenAPI spec at /openapi.json (consumed by SDK generation and CI)
 * and an interactive reference at /docs.
 */
export function setupOpenApi(app: NestFastifyApplication) {
  const config = new DocumentBuilder()
    .setTitle('Relay API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Your Relay API key' }, 'apiKey')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const http = app.getHttpAdapter();

  http.get('/openapi.json', (_req: unknown, reply: { send: (body: unknown) => void }) => {
    reply.send(document);
  });

  // Registered as a regular Fastify route: Scalar's default handler calls
  // `reply.type().send()`, which FastifyReply supports. (`withFastify` is for
  // middleware mode, where it receives the raw Node response instead.)
  const docsHandler = apiReference({
    content: document,
    theme: 'purple',
    pageTitle: 'Relay API Reference',
  }) as (req: unknown, reply: unknown) => void;
  http.get('/docs', docsHandler);

  return document;
}
