import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { TemperatureSampleEntity } from './entities/temperature-sample.entity';
import { DeliveryComplianceEntity } from './entities/delivery-compliance.entity';
import { RouteDeviationIncidentEntity } from '../route-deviation/entities/route-deviation-incident.entity';
import { ColdChainService } from './cold-chain.service';
import { ColdChainController } from './cold-chain.controller';
import { DeliveryTimelineService } from './delivery-timeline.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TemperatureSampleEntity,
      DeliveryComplianceEntity,
      RouteDeviationIncidentEntity,
    ]),
    ConfigModule,
  ],
  controllers: [ColdChainController],
  providers: [ColdChainService, DeliveryTimelineService],
  exports: [ColdChainService, DeliveryTimelineService],
})
export class ColdChainModule {}
