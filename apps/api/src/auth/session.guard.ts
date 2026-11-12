import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { Auth, AuthSession } from './auth.js';
import { AUTH } from './auth.tokens.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type RequestWithSession = FastifyRequest & { authSession?: AuthSession };

/**
 * Requires a valid dashboard session (cookie issued by Better Auth).
 * Programmatic access uses API keys instead (`ApiKeyGuard`).
 *
 * CSRF: cookies are sent automatically, so state-changing requests must also
 * come from a trusted origin. `SameSite=Lax` cookies already stop cross-site
 * form posts; this check also covers same-site attackers (e.g. a sibling
 * subdomain), which SameSite can't distinguish.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly trustedOrigins: ReadonlySet<string>;

  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(ENV) env: Env,
  ) {
    this.trustedOrigins = new Set([
      new URL(env.DASHBOARD_URL).origin,
      new URL(env.BETTER_AUTH_URL).origin,
    ]);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    if (!SAFE_METHODS.has(request.method) && !this.isTrustedOrigin(request)) {
      throw new ForbiddenException('Cross-origin request blocked.');
    }
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new UnauthorizedException('Sign in to access this resource.');
    request.authSession = session;
    return true;
  }

  private isTrustedOrigin(request: FastifyRequest): boolean {
    const source = request.headers.origin ?? request.headers.referer;
    if (!source) return false;
    try {
      return this.trustedOrigins.has(new URL(source).origin);
    } catch {
      return false; // malformed header
    }
  }
}

/** Injects the session resolved by `SessionGuard`. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthSession => {
    const session = context.switchToHttp().getRequest<RequestWithSession>().authSession;
    if (!session) throw new Error('CurrentSession used on a route without SessionGuard');
    return session;
  },
);
