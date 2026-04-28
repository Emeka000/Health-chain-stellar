import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { PolicyCenterModule } from '../policy-center/policy-center.module';

import { AnomalyController } from './anomaly.controller';
import { AnomalyScoringService } from './anomaly-scoring.service';
import { AnomalyService } from './anomaly.service';
import { AnomalyDriftService } from './anomaly-drift.service';
import { AnomalyIncidentEntity } from './entities/anomaly-incident.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnomalyIncidentEntity,
      BloodRequestEntity,
      OrderEntity,
    ]),
    PolicyCenterModule,
  ],
  controllers: [AnomalyController],
  providers: [AnomalyService, AnomalyScoringService, AnomalyDriftService],
  exports: [AnomalyService, AnomalyDriftService],
})
export class AnomalyModule {}
