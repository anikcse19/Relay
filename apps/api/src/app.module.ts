import { type DynamicModule, Module } from '@nestjs/common';
import type { DatabaseHandle } from '@relay/db';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { MeController } from './me/me.controller.js';

export interface AppModuleOptions {
  env: Env;
  database: DatabaseHandle;
}

@Module({})
export class AppModule {
  static forRoot({ env, database }: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(env), DatabaseModule.forRoot(database), AuthModule],
      controllers: [HealthController, MeController],
    };
  }
}
