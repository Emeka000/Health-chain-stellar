import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { SorobanRpcHealthIndicator } from './indicators/soroban-rpc.health-indicator';
import { BullMQHealthIndicator } from './indicators/bullmq.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly soroban: SorobanRpcHealthIndicator,
    private readonly bullmq: BullMQHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  /**
   * Public health check — returns only { status: 'ok' | 'error' }.
   * Does NOT leak internal hostnames or connection strings.
   */
  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Public liveness check' })
  async check() {
    try {
      await this.health.check([
        () => this.db.pingCheck('database'),
        () => this.redis.isHealthy('redis'),
        () => this.soroban.isHealthy('soroban_rpc'),
        () => this.bullmq.isHealthy('bullmq'),
      ]);
      return { status: 'ok' };
    } catch {
      return { status: 'error' };
    }
  }

  /**
   * Admin-only detailed breakdown — returns per-component status.
   * Gated by ADMIN JWT auth so internal details are never public.
   */
  @Get('details')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin:health:read')
  @HealthCheck()
  @ApiOperation({ summary: 'Admin detailed health breakdown' })
  async details() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.isHealthy('redis'),
      () => this.soroban.isHealthy('soroban_rpc'),
      () => this.bullmq.isHealthy('bullmq'),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }
}
