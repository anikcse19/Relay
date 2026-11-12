import { Global, Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { TenantGuard } from './tenant.guard.js';

/** Makes `TenantGuard` (API key or session auth) available to every feature module. */
@Global()
@Module({
  imports: [ApiKeysModule],
  providers: [TenantGuard],
  exports: [TenantGuard, ApiKeysModule],
})
export class TenancyModule {}
