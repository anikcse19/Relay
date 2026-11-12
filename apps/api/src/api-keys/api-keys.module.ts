import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeysController } from './api-keys.controller.js';

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard],
})
export class ApiKeysModule {}
