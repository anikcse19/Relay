import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import type { Auth, AuthSession } from './auth.js';
import { AUTH } from './auth.tokens.js';

type RequestWithSession = FastifyRequest & { authSession?: AuthSession };

/**
 * Requires a valid dashboard session (cookie issued by Better Auth).
 * Programmatic API access will use API keys instead (Session 3).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new UnauthorizedException('Sign in to access this resource.');
    request.authSession = session;
    return true;
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
