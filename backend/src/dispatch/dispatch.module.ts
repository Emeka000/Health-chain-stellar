import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DispatchService } from './dispatch.service';
import { DispatchController } from './dispatch.controller';
import { RiderAssignmentService } from './rider-assignment.service';
import { RidersModule } from '../riders/riders.module';
import { MapsModule } from '../maps/maps.module';

@Module({
  imports: [ConfigModule, EventEmitterModule.forRoot(), RidersModule, MapsModule],
  controllers: [DispatchController],
  providers: [DispatchService, RiderAssignmentService],
  exports: [DispatchService, RiderAssignmentService],
})
export class DispatchModule {}
