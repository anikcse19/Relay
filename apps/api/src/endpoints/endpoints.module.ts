import { Module } from '@nestjs/common';
import { EndpointsController } from './endpoints.controller.js';
import { EndpointsService } from './endpoints.service.js';

@Module({
  controllers: [EndpointsController],
  providers: [EndpointsService],
})
export class EndpointsModule {}
