import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { EscalationService } from './escalation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/escalations')
export class EscalationController {
  constructor(private readonly escalationService: EscalationService) {}

  @Get('open')
  getOpen(@Request() req: any) {
    return this.escalationService.findOpen({
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @Get('request/:requestId')
  getByRequest(@Param('requestId') requestId: string, @Request() req: any) {
    return this.escalationService.findByRequest(requestId, {
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @Post(':id/acknowledge')
  acknowledge(@Param('id') id: string, @Request() req: any) {
    return this.escalationService.acknowledge(id, {
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @Get('timeline')
  getTimeline(
    @Query('requestId') requestId?: string,
    @Query('escalationId') escalationId?: string,
    @Request() req?: any,
  ) {
    return this.escalationService.getTimeline({
      requestId,
      escalationId,
      actor: {
        userId: req?.user?.id ?? req?.user?.sub ?? 'unknown',
        role: req?.user?.role,
        organizationId: req?.user?.organizationId ?? null,
      },
    });
  }

  @Post(':id/links')
  addLinks(
    @Param('id') id: string,
    @Body()
    body: {
      incidentReviewId?: string;
      remediationTaskId?: string;
    },
    @Request() req: any,
  ) {
    return this.escalationService.addLinks(
      id,
      {
        userId: req.user?.id ?? req.user?.sub ?? 'unknown',
        role: req.user?.role,
        organizationId: req.user?.organizationId ?? null,
      },
      body,
    );
  }
}
