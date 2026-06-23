import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { RedisModule } from '../redis/redis.module';

import { LiveOpsGateway } from './gateways/live-ops.gateway';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';
import { RoutePlanningController } from './controllers/route-planning.controller';
import { RoutePlanningService } from './services/route-planning.service';

@Module({
  imports: [ConfigModule, RedisModule],
  controllers: [MapsController, RoutePlanningController],
  providers: [MapsService, LiveOpsGateway, RoutePlanningService],
  exports: [MapsService, LiveOpsGateway, RoutePlanningService],
})
export class MapsModule {}
