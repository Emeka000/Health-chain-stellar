import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReputationModule } from '../reputation/reputation.module';
import { UserActivityModule } from '../user-activity/user-activity.module';

import { IncidentReviewEntity } from './entities/incident-review.entity';
import { CorrectiveActionEntity } from './entities/corrective-action.entity';
import { IncidentEvidenceLinkEntity } from './entities/incident-evidence-link.entity';
import { IncidentReviewsController } from './incident-reviews.controller';
import { IncidentReviewsService } from './incident-reviews.service';
import { IncidentScoringListener } from './listeners/incident-scoring.listener';
import { AnomalyIncidentListener } from './listeners/anomaly-incident.listener';
import { SlaBreachListener } from './listeners/sla-breach.listener';
import { ComplianceViolationListener } from './listeners/compliance-violation.listener';
import { IncidentWorkflowScheduler } from './incident-workflow.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IncidentReviewEntity,
      CorrectiveActionEntity,
      IncidentEvidenceLinkEntity,
    ]),
    ReputationModule,
    UserActivityModule,
  ],
  controllers: [IncidentReviewsController],
  providers: [
    IncidentReviewsService,
    IncidentScoringListener,
    AnomalyIncidentListener,
    SlaBreachListener,
    ComplianceViolationListener,
    IncidentWorkflowScheduler,
  ],
  exports: [IncidentReviewsService],
})
export class IncidentReviewsModule { }
