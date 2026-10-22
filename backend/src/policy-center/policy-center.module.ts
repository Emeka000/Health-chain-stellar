import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PolicyVersionEntity } from './entities/policy-version.entity';
import { PolicyRolloutEntity } from './entities/policy-rollout.entity';
import { CanaryMetricEntity } from './entities/canary-metric.entity';
import { PolicyCenterController } from './policy-center.controller';
import { PolicyRolloutController } from './policy-rollout.controller';
import { PolicyCenterService } from './policy-center.service';
import { PolicyReplayService } from './policy-replay.service';
import { PolicyRolloutService } from './policy-rollout.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PolicyVersionEntity,
      PolicyRolloutEntity,
      CanaryMetricEntity,
    ]),
    ScheduleModule.forRoot(),
  ],
  controllers: [PolicyCenterController, PolicyRolloutController],
  providers: [PolicyCenterService, PolicyReplayService, PolicyRolloutService],
  exports: [PolicyCenterService, PolicyReplayService, PolicyRolloutService],
})
export class PolicyCenterModule {}
