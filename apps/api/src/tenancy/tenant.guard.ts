import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Database } from '@relay/db';
import type { FastifyRequest } from 'fastify';
import { ApiKeyGuard, type ApiKeyContext } from '../api-keys/api-key.guard.js';
import type { AuthSession } from '../auth/auth.js';
import { SessionGuard } from '../auth/session.guard.js';
import { DB } from '../database/database.module.js';
import { requireEnvironment, type Role } from './environment-access.js';

/** The organization + environment a request acts on, however it authenticated. */
export interface Tenant {
  organizationId: string;
  environmentId: string;
  /** `api_key` for programmatic calls, `session` for the dashboard. */
  via: 'api_key' | 'session';
}

/** Path prefix for the dashboard's (session-authenticated) form of a route. */
export const ENVIRONMENT_SCOPED = 'v1/environments/:environmentId';

const ROLES_KEY = 'relay:roles';
const ALL_ROLES: readonly Role[] = ['owner', 'admin', 'member'];

/**
 * Restricts a route to these roles when called with a dashboard session.
 * API keys are environment-scoped credentials that only owners and admins
 * can create, so they may call every route in their environment.
 */
export const RequireRoles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

type TenantRequest = FastifyRequest & {
  params: Record<string, string | undefined>;
  apiKey?: ApiKeyContext;
  authSession?: AuthSession;
  tenant?: Tenant;
};

/**
 * One guard, two ways in. Controllers register each route twice:
 *   `/v1/endpoints`                            → `Authorization: Bearer rk_…`
 *   `/v1/environments/:environmentId/endpoints` → dashboard session cookie
 * The path decides which credential is required; there is no fallback from
 * one to the other, so a request can never be authorised by a credential it
 * didn't intend to use. Either way the handler receives the same `Tenant`,
 * so the business logic exists once.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ApiKeyGuard) private readonly apiKeyGuard: ApiKeyGuard,
    @Inject(SessionGuard) private readonly sessionGuard: SessionGuard,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const environmentId = request.params.environmentId;

    if (environmentId === undefined) {
      await this.apiKeyGuard.canActivate(context);
      const key = request.apiKey!;
      request.tenant = {
        organizationId: key.organizationId,
        environmentId: key.environmentId,
        via: 'api_key',
      };
      return true;
    }

    await this.sessionGuard.canActivate(context);
    const roles =
      this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? ALL_ROLES;
    const env = await requireEnvironment(
      this.db,
      request.authSession!.user.id,
      environmentId,
      roles,
    );
    request.tenant = {
      organizationId: env.organizationId,
      environmentId: env.id,
      via: 'session',
    };
    return true;
  }
}

/** Injects the tenant resolved by `TenantGuard`. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Tenant => {
    const tenant = context.switchToHttp().getRequest<TenantRequest>().tenant;
    if (!tenant) throw new Error('CurrentTenant used on a route without TenantGuard');
    return tenant;
  },
);
