import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { ApprovalRequestEntity } from '../approvals/entities/approval-request.entity';
import { ApprovalActionType } from '../approvals/enums/approval.enum';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class ApprovalListener {
  private readonly logger = new Logger(ApprovalListener.name);

  constructor(private readonly ordersService: OrdersService) {}

  @OnEvent('approval.approved')
  async handleApprovalApproved(request: ApprovalRequestEntity) {
    this.logger.log(`Approval request approved: ${request.id} type=${request.actionType}`);

    try {
      if (request.actionType === ApprovalActionType.DISPUTE_RESOLUTION) {
        const payload = JSON.parse(request.finalPayload);
        await this.ordersService.finalizeDisputeResolution(payload.orderId, payload.resolution);
      }
      // Add other action types here as they are implemented
    } catch (error) {
      this.logger.error(`Failed to execute approved action ${request.id}: ${error.message}`);
    }
  }
}
