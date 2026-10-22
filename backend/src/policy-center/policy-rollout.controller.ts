import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import {
  PolicyRolloutService,
  StartRolloutDto,
} from './policy-rollout.service';

@ApiTags('Policy Center')
@ApiBearerAuth()
@Controller('policy-center/rollouts')
export class PolicyRolloutController {
  constructor(private readonly rolloutService: PolicyRolloutService) {}

  @ApiOperation({ summary: 'List policy rollouts' })
  @ApiResponse({ status: 200, description: 'List of rollouts' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get()
  list(@Query('policyVersionId') policyVersionId?: string) {
    return this.rolloutService.listRollouts(policyVersionId);
  }

  @ApiOperation({ summary: 'Get a rollout by ID' })
  @ApiResponse({ status: 200, description: 'Rollout record' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.rolloutService.getRollout(id);
  }

  @ApiOperation({ summary: 'Get rollout summary' })
  @ApiResponse({ status: 200, description: 'Rollout summary' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get(':id/summary')
  summary(@Param('id') id: string) {
    return this.rolloutService.getSummary(id);
  }

  @ApiOperation({ summary: 'Start a new policy rollout' })
  @ApiResponse({ status: 201, description: 'Rollout started' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post()
  start(@Body() dto: StartRolloutDto, @Req() req: { user?: { id?: string } }) {
    return this.rolloutService.startRollout(dto, req.user?.id ?? 'system');
  }

  @ApiOperation({ summary: 'Advance rollout to next step' })
  @ApiResponse({ status: 201, description: 'Rollout advanced' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post(':id/advance')
  advance(@Param('id') id: string, @Req() req: { user?: { id?: string } }) {
    return this.rolloutService.advanceStep(id, req.user?.id ?? 'system');
  }

  @ApiOperation({ summary: 'Emergency rollback of a rollout' })
  @ApiResponse({ status: 201, description: 'Rollout rolled back' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post(':id/rollback')
  rollback(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: { user?: { id?: string } },
  ) {
    return this.rolloutService.emergencyRollback(
      id,
      req.user?.id ?? 'system',
      body.reason,
    );
  }

  @ApiOperation({ summary: 'Record a rollout metric snapshot' })
  @ApiResponse({ status: 201, description: 'Metric recorded' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post(':id/metrics')
  recordMetric(
    @Param('id') id: string,
    @Body()
    body: {
      totalRequests: number;
      errorCount: number;
      avgLatencyMs?: number;
      p99LatencyMs?: number;
      extra?: Record<string, any>;
    },
  ) {
    return this.rolloutService.recordMetric(
      id,
      body.totalRequests,
      body.errorCount,
      body.avgLatencyMs,
      body.p99LatencyMs,
      body.extra,
    );
  }
}
