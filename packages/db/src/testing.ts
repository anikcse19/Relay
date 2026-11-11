/**
 * Test helpers: a real Postgres (PGlite = Postgres compiled to WASM) running
 * in-process. No Docker required; each call gets a fresh, fully migrated DB.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder } from './paths.js';
import * as schema from './schema.js';

export interface SqlExecutor {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return {
    db,
    /** Raw SQL executor with the same shape as `pg.Pool#query`. */
    sql: client as unknown as SqlExecutor,
    close: () => client.close(),
  };
}
