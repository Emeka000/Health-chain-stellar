import { Controller, Get, Post, Body, Param, UseGuards, Req, Ip, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/enums/permission.enum';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Request } from 'express';

import { ApprovalService } from './approval.service';
import { ApprovalStatus } from './enums/approval.enum';

@ApiTags('Approvals')
@Controller('approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get('pending')
  @RequirePermissions(Permission.REQUEST_APPROVE)
  @ApiOperation({ summary: 'Get all pending approval requests' })
  @ApiResponse({ status: 200, description: 'Requests fetched' })
  async getPending(@Req() req: Request) {
    return this.approvalService.getPendingRequests();
  }

  @Get(':id')
  @RequirePermissions(Permission.REQUEST_APPROVE)
  @ApiOperation({ summary: 'Get details of an approval request' })
  @ApiResponse({ status: 200, description: 'Request details fetched' })
  async getDetail(@Param('id') id: string) {
    return this.approvalService.getRequestById(id);
  }

  @Post(':id/approve')
  @RequirePermissions(Permission.REQUEST_APPROVE)
  @ApiOperation({ summary: 'Approve a request' })
  @ApiResponse({ status: 200, description: 'Request approved' })
  async approve(
    @Param('id') id: string,
    @Req() req: Request,
    @Ip() ipAddress: string,
    @Body('comment') comment?: string,
  ) {
    const user = (req as any).user;
    return this.approvalService.submitDecision({
      requestId: id,
      userId: user.id,
      decision: ApprovalStatus.APPROVED,
      comment,
      context: { ipAddress, userAgent: req.headers['user-agent'] },
    });
  }

  @Post(':id/reject')
  @RequirePermissions(Permission.REQUEST_APPROVE)
  @ApiOperation({ summary: 'Reject a request' })
  @ApiResponse({ status: 200, description: 'Request rejected' })
  async reject(
    @Param('id') id: string,
    @Req() req: Request,
    @Ip() ipAddress: string,
    @Body('comment') comment?: string,
  ) {
    const user = (req as any).user;
    return this.approvalService.submitDecision({
      requestId: id,
      userId: user.id,
      decision: ApprovalStatus.REJECTED,
      comment,
      context: { ipAddress, userAgent: req.headers['user-agent'] },
    });
  }
}
