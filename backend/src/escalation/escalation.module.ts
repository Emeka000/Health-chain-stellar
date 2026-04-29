import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EscalationEntity } from './entities/escalation.entity';
import { EscalationTimelineEventEntity } from './entities/escalation-timeline.entity';
import { EscalationService } from './escalation.service';
import { EscalationPolicyService } from './escalation-policy.service';
import { EscalationGateway } from './escalation.gateway';
import { EscalationController } from './escalation.controller';
import { EscalationSchedulerService } from './escalation-scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { IncidentReviewEntity } from '../incident-reviews/entities/incident-review.entity';
import { UserActivityModule } from '../user-activity/user-activity.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EscalationEntity,
      EscalationTimelineEventEntity,
      IncidentReviewEntity,
    ]),
    NotificationsModule,
    UserActivityModule,
  ],
  controllers: [EscalationController],
  providers: [
    EscalationService,
    EscalationPolicyService,
    EscalationGateway,
    EscalationSchedulerService,
  ],
  exports: [EscalationService],
})
export class EscalationModule {}
