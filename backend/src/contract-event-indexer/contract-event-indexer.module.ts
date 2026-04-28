import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ContractEventIndexerController } from './contract-event-indexer.controller';
import { ContractEventIndexerService } from './contract-event-indexer.service';
import { ContractEventEntity } from './entities/contract-event.entity';
import { IndexerCursorEntity } from './entities/indexer-cursor.entity';
import { PoisonEventEntity } from './entities/poison-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContractEventEntity,
      IndexerCursorEntity,
      PoisonEventEntity,
    ]),
  ],
  controllers: [ContractEventIndexerController],
  providers: [ContractEventIndexerService],
  exports: [ContractEventIndexerService],
})
export class ContractEventIndexerModule {}
