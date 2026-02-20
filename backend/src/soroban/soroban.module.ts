import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SorobanService } from './soroban.service';
import { SorobanIndexerService } from './soroban-indexer.service';
import { BlockchainEvent } from './entities/blockchain-event.entity';
import { BloodUnitTrail } from './entities/blood-unit-trail.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BlockchainEvent, BloodUnitTrail])],
  providers: [SorobanService, SorobanIndexerService],
  exports: [SorobanService],
})
export class SorobanModule {}
