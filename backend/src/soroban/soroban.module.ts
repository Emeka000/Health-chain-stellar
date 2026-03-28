import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainEvent } from './entities/blockchain-event.entity';
import { BloodUnitTrail } from './entities/blood-unit-trail.entity';
import { SorobanIndexerService } from './soroban-indexer.service';
import { SorobanService } from './soroban.service';
import { BlockchainAdminController } from './blockchain-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BlockchainEvent, BloodUnitTrail])],
  controllers: [BlockchainAdminController],
  providers: [SorobanService, SorobanIndexerService],
  exports: [SorobanService],
})
export class SorobanModule {}
