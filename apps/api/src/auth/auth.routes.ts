import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PROBLEM_CONTENT_TYPE } from '../common/problem-details.filter.js';
import { AUTH_BASE_PATH, type Auth } from './auth.js';

/**
 * Mounts Better Auth's handler on Fastify.
 *
 * Better Auth speaks the Fetch API (`Request` → `Response`), so we translate.
 * The routes live in an encapsulated plugin whose only body parser hands over
 * the raw bytes: Better Auth parses (and validates) bodies itself, and the
 * parser change doesn't leak to the rest of the API.
 */
export function registerAuthRoutes(fastify: FastifyInstance, auth: Auth): void {
  void fastify.register(async (instance) => {
    instance.removeAllContentTypeParsers();
    instance.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });

    instance.route({
      method: ['GET', 'POST'],
      url: `${AUTH_BASE_PATH}/*`,
      handler: (request, reply) => handle(auth, request, reply),
    });
  });
}

async function handle(auth: Auth, request: FastifyRequest, reply: FastifyReply) {
  try {
    const response = await auth.handler(toFetchRequest(request));

    reply.status(response.status);
    for (const [name, value] of response.headers) {
      if (name !== 'set-cookie') void reply.header(name, value);
    }
    // Multiple cookies must stay separate headers, never comma-joined.
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) void reply.header('set-cookie', cookies);

    return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
  } catch (error) {
    request.log.error({ err: error }, 'Auth handler failed');
    return reply
      .status(500)
      .header('content-type', PROBLEM_CONTENT_TYPE)
      .send({
        type: 'https://docs.relay.dev/errors/internal-server-error',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred. Please retry.',
        instance: request.url,
        requestId: String(request.id),
      });
  }
}

function toFetchRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody && Buffer.isBuffer(request.body) ? new Uint8Array(request.body) : undefined;

  return new Request(new URL(request.url, `${request.protocol}://${request.host}`), {
    method: request.method,
    headers,
    body,
  });
}
