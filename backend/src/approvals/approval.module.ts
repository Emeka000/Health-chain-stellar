import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrdersModule } from '../orders/orders.module';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { ApprovalDecisionEntity } from './entities/approval-decision.entity';
import { ApprovalRequestEntity } from './entities/approval-request.entity';
import { ApprovalController } from './approval.controller';
import { ApprovalListener } from './approval.listener';
import { ApprovalService } from './approval.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApprovalRequestEntity, ApprovalDecisionEntity]),
    forwardRef(() => OrdersModule),
    UserActivityModule,
  ],
  providers: [ApprovalService, ApprovalListener],
  controllers: [ApprovalController],
  exports: [ApprovalService],
})
export class ApprovalModule {}
