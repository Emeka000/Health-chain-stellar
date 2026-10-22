import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PolicyCenterModule } from '../policy-center/policy-center.module';
import { ReputationEntity } from '../reputation/entities/reputation.entity';
import { ReputationModule } from '../reputation/reputation.module';

import { AssignmentController } from './controllers/assignment.controller';
import { RiderSearchController } from './controllers/rider-search.controller';
import { AssignmentDecisionEntity } from './entities/assignment-decision.entity';
import { AssignmentWeightsEntity } from './entities/assignment-weights.entity';
import { RiderEntity } from './entities/rider.entity';
import { RidersController } from './riders.controller';
import { RidersService } from './riders.service';
import { ReputationAwareAssignmentService } from './services/reputation-aware-assignment.service';
import { RiderAvailabilityService } from './services/rider-availability.service';
import { RiderSearchService } from './services/rider-search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiderEntity,
      AssignmentWeightsEntity,
      AssignmentDecisionEntity,
      ReputationEntity,
    ]),
    ReputationModule,
    PolicyCenterModule,
  ],
  // RiderSearchController must be registered before RidersController so its
  // static routes (GET /riders/search, GET /riders/statistics) are matched
  // before RidersController's GET /riders/:id catch-all.
  controllers: [RiderSearchController, RidersController, AssignmentController],
  providers: [
    RidersService,
    ReputationAwareAssignmentService,
    RiderAvailabilityService,
    RiderSearchService,
  ],
  exports: [RidersService, ReputationAwareAssignmentService],
})
export class RidersModule {}
