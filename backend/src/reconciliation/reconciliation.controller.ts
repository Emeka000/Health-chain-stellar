import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { User } from '../auth/decorators/user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ExceptionCategory, MismatchResolution } from './enums/reconciliation.enum';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('Reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Post('runs')
  @RequirePermissions(Permission.SETTLEMENT_RELEASE)
  @ApiOperation({ summary: 'Trigger a new reconciliation run' })
  trigger(@User('id') userId: string) {
    return this.service.triggerRun(userId);
  }

  @Post('runs/:id/resume')
  @RequirePermissions(Permission.SETTLEMENT_RELEASE)
  @ApiOperation({ summary: 'Resume an interrupted reconciliation run from its last snapshot' })
  resume(@Param('id') id: string, @User('id') userId: string) {
    return this.service.triggerRun(userId, id);
  }

  @Get('runs')
  @RequirePermissions(Permission.READ_ANALYTICS)
  @ApiOperation({ summary: 'List reconciliation runs' })
  getRuns(@Query('limit') limit?: string) {
    return this.service.getRuns(limit ? parseInt(limit, 10) : 20);
  }

  @Get('mismatches')
  @RequirePermissions(Permission.READ_ANALYTICS)
  @ApiOperation({ summary: 'List mismatches, optionally filtered by run, resolution, or exception category' })
  getMismatches(
    @Query('runId') runId?: string,
    @Query('resolution') resolution?: MismatchResolution,
    @Query('exceptionCategory') exceptionCategory?: ExceptionCategory,
    @Query('limit') limit?: string,
  ) {
    return this.service.getMismatches(runId, resolution, exceptionCategory, limit ? parseInt(limit, 10) : 50);
  }

  @Post('mismatches/:id/resync')
  @RequirePermissions(Permission.SETTLEMENT_RELEASE)
  @ApiOperation({ summary: 'Resync a recoverable mismatch from on-chain state' })
  resync(@Param('id') id: string, @User('id') userId: string) {
    return this.service.resync(id, userId);
  }

  @Post('mismatches/:id/dismiss')
  @RequirePermissions(Permission.SETTLEMENT_RELEASE)
  @ApiOperation({ summary: 'Dismiss a mismatch with a note' })
  dismiss(
    @Param('id') id: string,
    @User('id') userId: string,
    @Body('note') note: string,
  ) {
    return this.service.dismiss(id, userId, note);
  }

  @Post('mismatches/:id/manual')
  @RequirePermissions(Permission.SETTLEMENT_RELEASE)
  @ApiOperation({ summary: 'Mark a mismatch as manually resolved' })
  markManual(
    @Param('id') id: string,
    @User('id') userId: string,
    @Body('note') note: string,
  ) {
    return this.service.markManual(id, userId, note);
  }
}
