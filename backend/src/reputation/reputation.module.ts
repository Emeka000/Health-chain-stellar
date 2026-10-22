import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RiderEntity } from '../riders/entities/rider.entity';

import { ReputationAbuseFlagEntity } from './entities/reputation-abuse-flag.entity';
import { ReputationHistoryEntity } from './entities/reputation-history.entity';
import { ReputationEntity } from './entities/reputation.entity';
import { ReputationAbuseController } from './reputation-abuse.controller';
import { ReputationAbuseService } from './reputation-abuse.service';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReputationEntity,
      ReputationHistoryEntity,
      ReputationAbuseFlagEntity,
      RiderEntity,
    ]),
  ],
  controllers: [ReputationController, ReputationAbuseController],
  providers: [ReputationService, ReputationAbuseService],
  exports: [ReputationService, ReputationAbuseService],
})
export class ReputationModule {}
