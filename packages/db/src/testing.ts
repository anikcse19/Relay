/**
 * Test helpers: a real Postgres (PGlite = Postgres compiled to WASM) running
 * in-process. No Docker required; each call gets a fresh, fully migrated DB.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database, DatabaseHandle, SqlExecutor } from './client.js';
import { migrationsFolder } from './paths.js';
import * as schema from './schema.js';

export type { SqlExecutor };

export async function createTestDb(): Promise<DatabaseHandle> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return {
    db: db as unknown as Database,
    sql: client as unknown as SqlExecutor,
    close: () => client.close(),
  };
}
