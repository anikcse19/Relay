/**
 * Test helpers: a real Postgres (PGlite = Postgres compiled to WASM) running
 * in-process. No Docker required; each call gets a fresh, fully migrated DB.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database, DatabaseHandle, SqlExecutor } from './client.js';
import type { Listener } from './live.js';
import { migrationsFolder } from './paths.js';
import * as schema from './schema.js';

export type { SqlExecutor };

export async function createTestDb(): Promise<DatabaseHandle> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  // PGlite implements LISTEN/NOTIFY in-process; it never disconnects.
  const listener: Listener = {
    listen: async (channel, onPayload) => {
      const unlisten = await client.listen(channel, onPayload);
      return () => unlisten();
    },
    onReconnect: () => {},
    close: async () => {},
  };
  return {
    db: db as unknown as Database,
    sql: client as unknown as SqlExecutor,
    listener,
    close: () => client.close(),
  };
}
