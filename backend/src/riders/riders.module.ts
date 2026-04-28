import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { ReputationEntity } from '../reputation/entities/reputation.entity';
import { ReputationModule } from '../reputation/reputation.module';
import { PolicyCenterModule } from '../policy-center/policy-center.module';

import { AssignmentDecisionEntity } from './entities/assignment-decision.entity';
import { AssignmentWeightsEntity } from './entities/assignment-weights.entity';
import { RiderEntity } from './entities/rider.entity';
import { RidersController } from './riders.controller';
import { RidersService } from './riders.service';
import { AssignmentController } from './controllers/assignment.controller';
import { ReputationAwareAssignmentService } from './services/reputation-aware-assignment.service';
import { RiderAvailabilityService } from './services/rider-availability.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiderEntity,
      AssignmentWeightsEntity,
      AssignmentDecisionEntity,
      ReputationEntity,
    ]),
    ScheduleModule.forRoot(),
    ReputationModule,
    PolicyCenterModule,
  ],
  controllers: [RidersController, AssignmentController],
  providers: [
    RidersService,
    ReputationAwareAssignmentService,
    RiderAvailabilityService,
  ],
  exports: [RidersService, ReputationAwareAssignmentService],
})
export class RidersModule {}
