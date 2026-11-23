import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SorobanService } from './services/soroban.service';
import { SorobanRpcClient } from '../../soroban/soroban.service';
import { SorobanProcessor } from './processors/soroban.processor';
import { SOROBAN_QUEUE } from './constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: SOROBAN_QUEUE,
    }),
  ],
  providers: [SorobanService, SorobanRpcClient, SorobanProcessor],
  exports: [SorobanService, SorobanRpcClient],
})
export class BlockchainModule {}
