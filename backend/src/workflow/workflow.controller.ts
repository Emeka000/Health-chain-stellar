import {
  Controller,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Request,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { WorkflowOrchestrationService } from './workflow-orchestration.service';

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly service: WorkflowOrchestrationService) {}

  @Post(':requestId/allocate')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  allocate(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: { unitIds: string[]; paymentId: string },
    @Request() req: { user: { stellarAddress?: string; sub: string } },
  ) {
    return this.service.allocateUnits({
      requestId,
      unitIds: body.unitIds,
      paymentId: body.paymentId,
      callerAddress: req.user.stellarAddress ?? req.user.sub,
    });
  }

  @Post(':requestId/confirm-delivery')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  confirmDelivery(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: { user: { stellarAddress?: string; sub: string } },
  ) {
    return this.service.confirmDelivery({
      requestId,
      callerAddress: req.user.stellarAddress ?? req.user.sub,
    });
  }

  @Post(':requestId/settle')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  settle(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: { user: { stellarAddress?: string; sub: string } },
  ) {
    return this.service.settlePayment({
      requestId,
      callerAddress: req.user.stellarAddress ?? req.user.sub,
    });
  }

  @Post(':requestId/rollback')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  rollback(@Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.service.rollback({ requestId });
  }
}
