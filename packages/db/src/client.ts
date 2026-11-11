import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export interface DbOptions {
  connectionString: string;
  /** Max pooled connections. Neon free tier: keep this small. */
  max?: number;
}

/** Driver-agnostic Drizzle database (node-postgres in prod, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Minimal raw-SQL interface satisfied by `pg.Pool`, `pg.Client` and PGlite. */
export interface SqlExecutor {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** Everything an app needs to talk to the database, plus how to release it. */
export interface DatabaseHandle {
  db: Database;
  sql: SqlExecutor;
  close(): Promise<void>;
}

export function createDb({ connectionString, max = 10 }: DbOptions): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max });
  const db = drizzle(pool, { schema });
  return { db, sql: pool, close: () => pool.end() };
}
