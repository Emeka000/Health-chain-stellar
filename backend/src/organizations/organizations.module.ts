import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderEntity } from '../orders/entities/order.entity';
import { SorobanModule } from '../soroban/soroban.module';

import { OrgGracePeriodEntity } from './entities/org-grace-period.entity';
import { OrgVerificationHistoryEntity } from './entities/org-verification-history.entity';
import { OrgTrustScoreHistoryEntity } from './entities/org-trust-score-history.entity';
import { OrgTrustScoreEntity } from './entities/org-trust-score.entity';
import { OrganizationReviewModerationLogEntity } from './entities/organization-review-moderation-log.entity';
import { OrganizationReviewReportEntity } from './entities/organization-review-report.entity';
import { OrganizationReviewEntity } from './entities/organization-review.entity';
import { OrganizationEntity } from './entities/organization.entity';
import { OrgTrustScoreController } from './controllers/org-trust-score.controller';
import { OrganizationRepository } from './organizations.repository';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrgTrustScoringService } from './services/org-trust-scoring.service';
import { OrgVerificationLifecycleService } from './services/org-verification-lifecycle.service';
import { OrganizationReviewsService } from './services/organization-reviews.service';
import { VerificationSyncService } from './services/verification-sync.service';
import { OrgStatsModule } from './stats/org-stats.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationEntity,
      OrderEntity,
      OrganizationReviewEntity,
      OrganizationReviewReportEntity,
      OrganizationReviewModerationLogEntity,
      OrgTrustScoreEntity,
      OrgTrustScoreHistoryEntity,
      OrgVerificationHistoryEntity,
      OrgGracePeriodEntity,
    ]),
    BlockchainModule,
    SorobanModule,
    NotificationsModule,
    OrgStatsModule,
    AuthModule,
  ],
  controllers: [OrganizationsController, OrgTrustScoreController],
  providers: [
    OrganizationRepository,
    OrganizationsService,
    OrganizationReviewsService,
    VerificationSyncService,
    OrgTrustScoringService,
    OrgVerificationLifecycleService,
  ],
  exports: [
    OrganizationRepository,
    OrganizationsService,
    OrganizationReviewsService,
    VerificationSyncService,
    OrgTrustScoringService,
    OrgVerificationLifecycleService,
  ],
})
export class OrganizationsModule {}
