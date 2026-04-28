import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { OrgTrustScoreHistoryEntity } from './entities/org-trust-score-history.entity';
import { OrgTrustScoreEntity } from './entities/org-trust-score.entity';
import { OrganizationReviewModerationLogEntity } from './entities/organization-review-moderation-log.entity';
import { OrganizationReviewReportEntity } from './entities/organization-review-report.entity';
import { OrganizationReviewEntity } from './entities/organization-review.entity';
import { OrganizationEntity } from './entities/organization.entity';
import { OrgTrustScoreController } from './controllers/org-trust-score.controller';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrgTrustScoringService } from './services/org-trust-scoring.service';
import { OrganizationReviewsService } from './services/organization-reviews.service';
import { VerificationSyncService } from './services/verification-sync.service';
import { OrgStatsModule } from './stats/org-stats.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationEntity,
      OrganizationReviewEntity,
      OrganizationReviewReportEntity,
      OrganizationReviewModerationLogEntity,
      OrgTrustScoreEntity,
      OrgTrustScoreHistoryEntity,
    ]),
    BlockchainModule,
    NotificationsModule,
    OrgStatsModule,
  ],
  controllers: [OrganizationsController, OrgTrustScoreController],
  providers: [OrganizationsService, OrganizationReviewsService, VerificationSyncService, OrgTrustScoringService],
  exports: [OrganizationsService, OrganizationReviewsService, VerificationSyncService, OrgTrustScoringService],
})
export class OrganizationsModule {}
