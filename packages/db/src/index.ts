export * from './schema.js';
/** All tables as one object, for libraries that take a schema map (e.g. Better Auth). */
export * as schema from './schema.js';
/**
 * Query operators, re-exported so apps never import `drizzle-orm` directly:
 * a second copy of drizzle (e.g. resolved with different peer dependencies)
 * makes its `SQL`/`Column` types incompatible with this package's schema.
 */
export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
export * from './client.js';
export { migrationsFolder } from './paths.js';
