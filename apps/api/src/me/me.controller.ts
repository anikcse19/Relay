import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import { asc, type Database, environments, eq, inArray, members, organizations } from '@relay/db';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession, SessionGuard } from '../auth/session.guard.js';
import { DB } from '../database/database.module.js';

const meSchema: SchemaObject = {
  type: 'object',
  properties: {
    user: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'usr_01JD3X8Z5K2M4N6P8Q0R2S4T6V' },
        name: { type: 'string' },
        email: { type: 'string' },
        emailVerified: { type: 'boolean' },
        image: { type: 'string', nullable: true },
      },
    },
    activeOrganizationId: { type: 'string', nullable: true },
    organizations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          role: { type: 'string', enum: ['owner', 'admin', 'member'] },
          environments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                kind: { type: 'string', enum: ['development', 'production'] },
              },
            },
          },
        },
      },
    },
  },
};

@ApiTags('Account')
@ApiCookieAuth('session')
@Controller('v1/me')
@UseGuards(SessionGuard)
export class MeController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @ApiOperation({ summary: 'Current user, their organizations and environments' })
  @ApiOkResponse({ schema: meSchema })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  async me(@CurrentSession() { user, session }: AuthSession) {
    const orgs = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: members.role,
      })
      .from(members)
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .where(eq(members.userId, user.id))
      .orderBy(asc(members.createdAt));

    const envs = orgs.length
      ? await this.db
          .select({
            id: environments.id,
            organizationId: environments.organizationId,
            name: environments.name,
            kind: environments.kind,
          })
          .from(environments)
          .where(
            inArray(
              environments.organizationId,
              orgs.map((o) => o.id),
            ),
          )
          .orderBy(asc(environments.kind), asc(environments.name)) // enum order: development first
      : [];

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image ?? null,
      },
      activeOrganizationId: session.activeOrganizationId ?? null,
      organizations: orgs.map((org) => ({
        ...org,
        environments: envs
          .filter((e) => e.organizationId === org.id)
          .map(({ organizationId: _, ...e }) => e),
      })),
    };
  }
}
