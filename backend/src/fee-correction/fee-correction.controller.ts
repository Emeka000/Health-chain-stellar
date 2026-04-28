import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { User } from '../auth/decorators/user.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { FeeCorrectionService } from './fee-correction.service';
import { FeeCorrectionRunStatus } from './enums/fee-correction.enum';
import {
  ExecuteFeeCorrectionDto,
  FeeCorrectionQueryDto,
  InitiateFeeCorrectionDto,
} from './dto/fee-correction.dto';

@Controller('fee-corrections')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FeeCorrectionController {
  constructor(private readonly service: FeeCorrectionService) {}

  /**
   * Initiate a retroactive fee correction run.
   *
   * Creates a correction run in PENDING_APPROVAL status and raises a
   * dual-control approval request. Execution is blocked until approved.
   *
   * Idempotent: re-submitting with the same idempotencyKey returns the
   * existing run without creating a duplicate.
   */
  @Post()
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  async initiate(
    @Body(new ValidationPipe({ whitelist: true })) dto: InitiateFeeCorrectionDto,
    @User('id') userId: string,
  ) {
    return this.service.initiate(dto, userId);
  }

  /**
   * Execute an approved correction run.
   *
   * The run must be in APPROVED or INTERRUPTED status.
   * Execution is asynchronous — the response returns immediately with
   * the run in RUNNING status.
   */
  @Post(':id/execute')
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  async execute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: Partial<ExecuteFeeCorrectionDto>,
    @User('id') userId: string,
  ) {
    return this.service.execute({ runId: id, ...dto }, userId);
  }

  /**
   * List all correction runs with optional status filter and pagination.
   */
  @Get()
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  async listRuns(
    @Query('status') status?: FeeCorrectionRunStatus,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.service.listRuns(status, page, pageSize);
  }

  /**
   * Get a single correction run by ID.
   */
  @Get(':id')
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  async getRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findRun(id);
  }

  /**
   * List adjustment entries for a run, order, or status.
   */
  @Get('entries')
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  async listEntries(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: FeeCorrectionQueryDto,
  ) {
    return this.service.listEntries(query);
  }

  /**
   * Get the full fee adjustment history for a specific order.
   * Useful for auditing and reconciliation views.
   */
  @Get('orders/:orderId/fee-history')
  @RequirePermissions(Permission.VIEW_FEE_POLICIES)
  async getOrderFeeHistory(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.service.getOrderFeeHistory(orderId);
  }

  /**
   * Verify that re-running the correction with the same inputs produces
   * the same audit hashes (reproducibility check).
   */
  @Get(':id/verify-reproducibility')
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  async verifyReproducibility(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.verifyReproducibility(id);
  }
}
