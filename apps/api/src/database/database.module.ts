import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { DatabaseHandle } from '@relay/db';

/** Drizzle database (typed query builder). */
export const DB = Symbol('DB');
/** Raw SQL executor, for hand-tuned queries and health checks. */
export const SQL = Symbol('SQL');
const HANDLE = Symbol('DATABASE_HANDLE');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(HANDLE) private readonly handle: DatabaseHandle) {}

  /** Drain the connection pool on SIGTERM so in-flight queries can finish. */
  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

/**
 * The connection is created by the caller (main.ts / tests) and handed in.
 * This keeps the module free of environment lookups and lets tests inject
 * PGlite or a failing stub without any mocking framework.
 */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(handle: DatabaseHandle): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: HANDLE, useValue: handle },
        { provide: DB, useValue: handle.db },
        { provide: SQL, useValue: handle.sql },
        DatabaseLifecycle,
      ],
      exports: [DB, SQL],
    };
  }
}
