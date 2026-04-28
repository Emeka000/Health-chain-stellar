import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrderEntity } from '../orders/entities/order.entity';

import { BlockchainEvent } from './entities/blockchain-event.entity';
import { BloodUnitTrail } from './entities/blood-unit-trail.entity';
import { IndexerStateEntity } from './entities/indexer-state.entity';
import { ReconciliationLogEntity } from './entities/reconciliation-log.entity';
import { SorobanIndexerService } from './soroban-indexer.service';
import { SorobanService } from './soroban.service';
import { BlockchainAdminController } from './blockchain-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BlockchainEvent,
      BloodUnitTrail,
      IndexerStateEntity,
      ReconciliationLogEntity,
      OrderEntity,
    ]),
  ],
  controllers: [BlockchainAdminController],
  providers: [SorobanService, SorobanIndexerService],
  exports: [SorobanService, SorobanIndexerService],
})
export class SorobanModule {}
