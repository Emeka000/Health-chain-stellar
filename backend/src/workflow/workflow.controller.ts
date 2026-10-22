import {
  Controller,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

import { WorkflowOrchestrationService } from './workflow-orchestration.service';

@ApiTags('Workflow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly service: WorkflowOrchestrationService) {}

  @Post(':requestId/allocate')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({
    summary: 'Allocate blood units to a request',
    description: 'Allocate specific blood units to a blood request',
  })
  @ApiResponse({
    status: 200,
    description: 'Units allocated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
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
  @ApiOperation({
    summary: 'Confirm delivery of allocated units',
    description: 'Confirm that the allocated units have been delivered',
  })
  @ApiResponse({
    status: 200,
    description: 'Delivery confirmed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
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
  @ApiOperation({
    summary: 'Settle payment for delivered units',
    description: 'Complete payment settlement for a delivery',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment settled successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
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
  @ApiOperation({
    summary: 'Rollback a workflow',
    description: 'Rollback a workflow to a previous state',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow rolled back successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  rollback(@Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.service.rollback({ requestId });
  }
}
