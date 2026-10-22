import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';

import { RoutePlanningController } from './controllers/route-planning.controller';
import { LiveOpsGateway } from './gateways/live-ops.gateway';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';
import { RoutePlanningService } from './services/route-planning.service';

@Module({
  imports: [ConfigModule, RedisModule, AuthModule],
  controllers: [MapsController, RoutePlanningController],
  providers: [MapsService, LiveOpsGateway, RoutePlanningService],
  exports: [MapsService, LiveOpsGateway, RoutePlanningService],
})
export class MapsModule {}
