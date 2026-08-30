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
@ApiTags('Escalations')
@ApiBearerAuth()
@Controller('api/v1/escalations')
export class EscalationController {
  constructor(private readonly escalationService: EscalationService) {}

  @ApiOperation({ summary: 'Get open' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('open')
  getOpen(@Request() req: any) {
    return this.escalationService.findOpen({
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @ApiOperation({ summary: 'Get request :requestId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('request/:requestId')
  getByRequest(@Param('requestId') requestId: string, @Request() req: any) {
    return this.escalationService.findByRequest(requestId, {
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @ApiOperation({ summary: 'Post :id acknowledge' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/acknowledge')
  acknowledge(@Param('id') id: string, @Request() req: any) {
    return this.escalationService.acknowledge(id, {
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @ApiOperation({ summary: 'Get timeline' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
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

  @ApiOperation({ summary: 'Post :id links' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
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
