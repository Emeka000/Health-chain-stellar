import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { SorobanRpcHealthIndicator } from './indicators/soroban-rpc.health-indicator';
import { BullMQHealthIndicator } from './indicators/bullmq.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';
import { FirebaseHealthIndicator } from './indicators/firebase.health-indicator';
import { SmsHealthIndicator } from './indicators/sms.health-indicator';

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
    private readonly firebase: FirebaseHealthIndicator,
    private readonly sms: SmsHealthIndicator,
  ) {}

  /** Liveness check: confirm this process can serve requests, without dependency I/O. */
  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Legacy readiness check' })
  check() {
    return this.checkReadiness();
  }

  @Get('live')
  @Public()
  @ApiOperation({ summary: 'Process liveness check' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Database and Redis readiness check' })
  ready() {
    return this.checkReadiness();
  }

  /**
   * Admin-only detailed breakdown — returns per-component status.
   * Gated by ADMIN JWT auth so internal details are never public.
   */
  @Get('details')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @HealthCheck()
  @ApiOperation({ summary: 'Admin detailed health breakdown' })
  async details() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.isHealthy('redis'),
      () => this.soroban.isHealthy('soroban_rpc'),
      () => this.bullmq.isHealthy('bullmq'),
      () => this.firebase.isHealthy('firebase'),
      () => this.sms.isHealthy('sms'),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }

  private checkReadiness() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
