import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [ApiKeysModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
