import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserActivityModule } from '../user-activity/user-activity.module';
import { ApprovalRequestEntity } from './entities/approval-request.entity';
import { ApprovalDecisionEntity } from './entities/approval-decision.entity';
import { ApprovalService } from './approval.service';
import { ApprovalController } from './approval.controller';
import { ApprovalListener } from './approval.listener';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApprovalRequestEntity, ApprovalDecisionEntity]),
    UserActivityModule,
    forwardRef(() => OrdersModule),
  ],
  providers: [ApprovalService, ApprovalListener],
  controllers: [ApprovalController],
  exports: [ApprovalService],
})
export class ApprovalModule {}
