import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainModule } from '../blockchain/blockchain.module';
import { OrderEntity } from '../orders/entities/order.entity';

import { WorkflowController } from './workflow.controller';
import { WorkflowOrchestrationService } from './workflow-orchestration.service';

@Module({
  imports: [BlockchainModule, TypeOrmModule.forFeature([OrderEntity])],
  controllers: [WorkflowController],
  providers: [WorkflowOrchestrationService],
  exports: [WorkflowOrchestrationService],
})
export class WorkflowModule {}
