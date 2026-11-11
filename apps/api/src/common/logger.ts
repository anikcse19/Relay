import type { LoggerService } from '@nestjs/common';
import type { FastifyServerOptions } from 'fastify';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';

/**
 * Pino options for Fastify. JSON logs in production (ready for Loki /
 * OpenTelemetry), pretty logs in development, and secrets always redacted.
 */
export function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[redacted]',
    },
    ...(env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname', singleLine: true },
      },
    }),
  };
}

/** Routes Nest's own framework logs into the same pino instance as requests. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly pino: Logger) {}

  log(message: unknown, ...rest: unknown[]) {
    this.write('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.write('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.write('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.write('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.write('trace', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]) {
    this.write('fatal', message, rest);
  }

  private write(
    level: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal',
    message: unknown,
    rest: unknown[],
  ) {
    // Nest passes the context (e.g. "RoutesResolver") as the last string argument.
    const context = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
    if (message instanceof Error) {
      this.pino[level]({ context, err: message }, message.message);
    } else if (typeof message === 'object' && message !== null) {
      this.pino[level]({ context, ...message });
    } else {
      this.pino[level]({ context }, String(message));
    }
  }
}
