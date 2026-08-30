import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrderEntity } from '../orders/entities/order.entity';
import { ContractEventIndexerModule } from '../contract-event-indexer/contract-event-indexer.module';
import { RedisModule } from '../redis/redis.module';

import { BlockchainEvent } from './entities/blockchain-event.entity';
import { BloodUnitTrail } from './entities/blood-unit-trail.entity';
import { IndexerStateEntity } from './entities/indexer-state.entity';
import { ReconciliationLogEntity } from './entities/reconciliation-log.entity';
import { BlockchainAdminController } from './blockchain-admin.controller';
import { SorobanIndexerService } from './soroban-indexer.service';
import { SorobanService } from './soroban.service';

@Module({
  imports: [
    RedisModule,
    TypeOrmModule.forFeature([
      BlockchainEvent,
      BloodUnitTrail,
      IndexerStateEntity,
      ReconciliationLogEntity,
      OrderEntity,
    ]),
    ContractEventIndexerModule,
  ],
  controllers: [BlockchainAdminController],
  providers: [SorobanService, SorobanIndexerService],
  exports: [SorobanService, SorobanIndexerService],
})
export class SorobanModule {}
