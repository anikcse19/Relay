import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export interface DbOptions {
  connectionString: string;
  /** Max pooled connections. Neon free tier: keep this small. */
  max?: number;
}

export function createDb({ connectionString, max = 10 }: DbOptions) {
  const pool = new pg.Pool({ connectionString, max });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Database = ReturnType<typeof createDb>['db'];
