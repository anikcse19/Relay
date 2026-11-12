import { Module } from '@nestjs/common';
import { LiveController } from './live.controller.js';
import { LiveHub } from './live-hub.js';

@Module({
  controllers: [LiveController],
  providers: [LiveHub],
})
export class LiveModule {}
