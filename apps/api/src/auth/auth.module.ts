import { Global, Module } from '@nestjs/common';
import type { Database } from '@relay/db';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB } from '../database/database.module.js';
import { createAuth } from './auth.js';
import { AUTH } from './auth.tokens.js';
import { SessionGuard } from './session.guard.js';

export { AUTH };

@Global()
@Module({
  providers: [
    {
      provide: AUTH,
      inject: [ENV, DB],
      useFactory: (env: Env, db: Database) => createAuth(env, db),
    },
    SessionGuard,
  ],
  exports: [AUTH, SessionGuard],
})
export class AuthModule {}
