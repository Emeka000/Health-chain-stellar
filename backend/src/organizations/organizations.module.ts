import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { OrganizationReviewModerationLogEntity } from './entities/organization-review-moderation-log.entity';
import { OrganizationReviewReportEntity } from './entities/organization-review-report.entity';
import { OrganizationReviewEntity } from './entities/organization-review.entity';
import { OrganizationEntity } from './entities/organization.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationReviewsService } from './services/organization-reviews.service';
import { OrgStatsModule } from './stats/org-stats.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationEntity,
      OrganizationReviewEntity,
      OrganizationReviewReportEntity,
      OrganizationReviewModerationLogEntity,
    ]),
    BlockchainModule,
    NotificationsModule,
    OrgStatsModule,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationReviewsService],
  exports: [OrganizationsService, OrganizationReviewsService],
})
export class OrganizationsModule {}
