import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import {
  PolicyRolloutService,
  StartRolloutDto,
} from './policy-rollout.service';

@Controller('policy-center/rollouts')
export class PolicyRolloutController {
  constructor(private readonly rolloutService: PolicyRolloutService) {}

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get()
  list(@Query('policyVersionId') policyVersionId?: string) {
    return this.rolloutService.listRollouts(policyVersionId);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.rolloutService.getRollout(id);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get(':id/summary')
  summary(@Param('id') id: string) {
    return this.rolloutService.getSummary(id);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post()
  start(@Body() dto: StartRolloutDto, @Req() req: { user?: { id?: string } }) {
    return this.rolloutService.startRollout(dto, req.user?.id ?? 'system');
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post(':id/advance')
  advance(@Param('id') id: string, @Req() req: { user?: { id?: string } }) {
    return this.rolloutService.advanceStep(id, req.user?.id ?? 'system');
  }

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
