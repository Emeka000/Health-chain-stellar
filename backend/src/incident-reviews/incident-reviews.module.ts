import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReputationModule } from '../reputation/reputation.module';

import { IncidentReviewEntity } from './entities/incident-review.entity';
import { IncidentReviewsController } from './incident-reviews.controller';
import { IncidentReviewsService } from './incident-reviews.service';
import { IncidentScoringListener } from './listeners/incident-scoring.listener';

@Module({
  imports: [TypeOrmModule.forFeature([IncidentReviewEntity]), ReputationModule],
  controllers: [IncidentReviewsController],
  providers: [IncidentReviewsService, IncidentScoringListener],
  exports: [IncidentReviewsService],
})
export class IncidentReviewsModule {}
