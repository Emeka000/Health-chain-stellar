import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainModule } from '../blockchain/blockchain.module';
import { OrderEntity } from '../orders/entities/order.entity';
import { RegistryModule } from '../registry/registry.module';

import { WorkflowController } from './workflow.controller';
import { WorkflowOrchestrationService } from './workflow-orchestration.service';

@Module({
  imports: [BlockchainModule, TypeOrmModule.forFeature([OrderEntity]), RegistryModule],
  controllers: [WorkflowController],
  providers: [WorkflowOrchestrationService],
  exports: [WorkflowOrchestrationService],
})
export class WorkflowModule {}