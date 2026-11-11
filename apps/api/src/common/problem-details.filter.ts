import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

/** RFC 9457 "Problem Details for HTTP APIs" response body. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  /** Correlates this response with server logs; quote it in support requests. */
  requestId: string;
  /** Field-level validation errors. */
  errors?: { path: string; message: string }[];
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const PROBLEM_BASE = 'https://docs.relay.dev/errors/';

const slug = (status: number) =>
  (STATUS_CODES[status] ?? 'error').toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * Converts every thrown error into a consistent RFC 9457 response.
 * Clients (and our SDK) handle one error shape everywhere, and internal
 * details of unexpected errors never leak to callers.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const problem = this.toProblem(exception, request);

    if (problem.status >= 500) {
      this.logger.error({ err: exception, reqId: request.id }, 'Unhandled error');
    }

    void reply.status(problem.status).header('content-type', PROBLEM_CONTENT_TYPE).send(problem);
  }

  private toProblem(exception: unknown, request: FastifyRequest): ProblemDetails {
    const base = { instance: request.url, requestId: String(request.id) };

    if (exception instanceof ZodError) {
      return {
        ...base,
        type: `${PROBLEM_BASE}validation-failed`,
        title: 'Validation failed',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        detail: 'The request contains invalid fields.',
        errors: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        ...base,
        type: `${PROBLEM_BASE}${slug(status)}`,
        title: STATUS_CODES[status] ?? 'Error',
        status,
        detail: extractDetail(exception.getResponse()),
      };
    }

    // Errors raised by Fastify itself (e.g. malformed JSON body) carry a statusCode.
    const statusCode = (exception as { statusCode?: unknown } | null)?.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return {
        ...base,
        type: `${PROBLEM_BASE}${slug(statusCode)}`,
        title: STATUS_CODES[statusCode] ?? 'Error',
        status: statusCode,
        detail: (exception as Error).message,
      };
    }

    return {
      ...base,
      type: `${PROBLEM_BASE}internal-server-error`,
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail:
        'An unexpected error occurred. Please retry, and contact support with the requestId if it persists.',
    };
  }
}

function extractDetail(response: string | object): string | undefined {
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : undefined;
}
