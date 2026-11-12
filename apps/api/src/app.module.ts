import { type DynamicModule, Module } from '@nestjs/common';
import type { DatabaseHandle } from '@relay/db';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { DeliveriesModule } from './deliveries/deliveries.module.js';
import { EndpointsModule } from './endpoints/endpoints.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { MeController } from './me/me.controller.js';
import { TenancyModule } from './tenancy/tenancy.module.js';

export interface AppModuleOptions {
  env: Env;
  database: DatabaseHandle;
}

@Module({})
export class AppModule {
  static forRoot({ env, database }: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        DatabaseModule.forRoot(database),
        AuthModule,
        ApiKeysModule,
        TenancyModule,
        EndpointsModule,
        EventsModule,
        DeliveriesModule,
      ],
      controllers: [HealthController, MeController],
    };
  }
}
