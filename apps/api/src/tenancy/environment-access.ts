import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, type Database, environments, eq, members } from '@relay/db';

export type Role = 'owner' | 'admin' | 'member';

export interface AccessibleEnvironment {
  id: string;
  organizationId: string;
  kind: 'development' | 'production';
  role: Role;
}

/**
 * Resolves an environment the user may act on, or throws.
 *
 * Non-members get 404 rather than 403, so environment ids from other
 * tenants can't be confirmed to exist. Members whose role is too low get
 * 403: they can already see the environment, so nothing leaks.
 */
export async function requireEnvironment(
  db: Database,
  userId: string,
  environmentId: string,
  allowedRoles: readonly Role[] = ['owner', 'admin', 'member'],
): Promise<AccessibleEnvironment> {
  const [row] = await db
    .select({
      id: environments.id,
      organizationId: environments.organizationId,
      kind: environments.kind,
      role: members.role,
    })
    .from(environments)
    .innerJoin(
      members,
      and(eq(members.organizationId, environments.organizationId), eq(members.userId, userId)),
    )
    .where(eq(environments.id, environmentId))
    .limit(1);

  if (!row) throw new NotFoundException('Environment not found.');
  const role = row.role as Role;
  if (!allowedRoles.includes(role)) {
    throw new ForbiddenException(
      `This action requires one of these roles: ${allowedRoles.join(', ')}.`,
    );
  }
  return { ...row, role };
}
