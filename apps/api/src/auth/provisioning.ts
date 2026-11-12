import {
  asc,
  type Database,
  environments,
  eq,
  members,
  organizations,
  sql,
  users,
} from '@relay/db';
import { newId, ulid } from '@relay/shared';

/** Environments every new organization starts with (Stripe-style test vs live). */
export const DEFAULT_ENVIRONMENTS = [
  { name: 'Development', kind: 'development' },
  { name: 'Production', kind: 'production' },
] as const;

export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents: "Café" → "cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // Random suffix: slugs are globally unique, and two "Acme" orgs must not collide.
  return `${base || 'workspace'}-${ulid().slice(-6).toLowerCase()}`;
}

function workspaceName(userName: string): string {
  const first = userName.trim().split(/\s+/)[0];
  return first ? `${first}'s Workspace` : 'My Workspace';
}

async function firstOrganizationId(db: Database, userId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ organizationId: members.organizationId })
    .from(members)
    .where(eq(members.userId, userId))
    .orderBy(asc(members.createdAt))
    .limit(1);
  return row?.organizationId;
}

/**
 * Guarantees the user belongs to at least one organization and returns its id.
 *
 * Creates the organization, the owner membership and the default environments
 * in ONE transaction, so a tenant can never exist half-provisioned. Idempotent
 * and safe under concurrency: a per-user advisory lock serialises callers, and
 * the membership check is repeated inside the lock. That makes it safe to call
 * both right after sign-up and on every sign-in (which self-heals a user whose
 * sign-up crashed between creating the user and provisioning the workspace).
 */
export async function ensureDefaultOrganization(db: Database, userId: string): Promise<string> {
  const existing = await firstOrganizationId(db, userId);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`provision:${userId}`}))`);

    const raced = await firstOrganizationId(tx, userId);
    if (raced) return raced;

    const [user] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new Error(`Cannot provision workspace: user ${userId} not found`);

    const name = workspaceName(user.name);
    const organizationId = newId('organization');

    await tx.insert(organizations).values({ id: organizationId, name, slug: slugify(name) });
    await tx.insert(members).values({
      id: newId('membership'),
      organizationId,
      userId,
      role: 'owner',
    });
    await tx.insert(environments).values(
      DEFAULT_ENVIRONMENTS.map((env) => ({
        id: newId('environment'),
        organizationId,
        name: env.name,
        kind: env.kind,
      })),
    );

    return organizationId;
  });
}
