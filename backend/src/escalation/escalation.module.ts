import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

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
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
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
