import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApprovalModule } from '../approvals/approval.module';
import { FeePolicyModule } from '../fee-policy/fee-policy.module';
import { OrderEntity } from '../orders/entities/order.entity';

import { FeeAdjustmentEntryEntity } from './entities/fee-adjustment-entry.entity';
import { FeeCorrectionRunEntity } from './entities/fee-correction-run.entity';
import { FeeCorrectionController } from './fee-correction.controller';
import { FeeCorrectionListener } from './fee-correction.listener';
import { FeeCorrectionService } from './fee-correction.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeeCorrectionRunEntity,
      FeeAdjustmentEntryEntity,
      OrderEntity,
    ]),
    FeePolicyModule,
    ApprovalModule,
  ],
  controllers: [FeeCorrectionController],
  providers: [FeeCorrectionService, FeeCorrectionListener],
  exports: [FeeCorrectionService],
})
export class FeeCorrectionModule {}
