import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RiderEntity } from '../riders/entities/rider.entity';

import { ReputationHistoryEntity } from './entities/reputation-history.entity';
import { ReputationEntity } from './entities/reputation.entity';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReputationEntity,
      ReputationHistoryEntity,
      RiderEntity,
    ]),
  ],
  controllers: [ReputationController],
  providers: [ReputationService],
  exports: [ReputationService],
})
export class ReputationModule {}
