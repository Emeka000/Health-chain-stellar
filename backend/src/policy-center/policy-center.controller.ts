import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { CreatePolicyVersionDto } from './dto/create-policy-version.dto';
import { ListPolicyVersionsDto } from './dto/list-policy-versions.dto';
import { UpdatePolicyVersionDto } from './dto/update-policy-version.dto';
import { PolicyCenterService } from './policy-center.service';
import { PolicyReplayService } from './policy-replay.service';

@Controller('policy-center')
export class PolicyCenterController {
  constructor(
    private readonly policyCenterService: PolicyCenterService,
    private readonly replayService: PolicyReplayService,
  ) {}

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('versions')
  listVersions(@Query() query: ListPolicyVersionsDto) {
    return this.policyCenterService.listVersions(query);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('versions/:id')
  getVersion(@Param('id') id: string) {
    return this.policyCenterService.getVersion(id);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post('versions')
  createVersion(@Body() dto: CreatePolicyVersionDto, @Req() req: { user?: { id?: string } }) {
    return this.policyCenterService.createVersion(dto, req.user?.id ?? 'system');
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Patch('versions/:id')
  updateVersion(@Param('id') id: string, @Body() dto: UpdatePolicyVersionDto) {
    return this.policyCenterService.updateVersion(id, dto);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post('versions/:id/activate')
  activateVersion(@Param('id') id: string, @Req() req: { user?: { id?: string } }) {
    return this.policyCenterService.activateVersion(id, req.user?.id ?? 'system');
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post('versions/:id/rollback')
  rollbackVersion(@Param('id') id: string, @Req() req: { user?: { id?: string } }) {
    return this.policyCenterService.rollbackToVersion(id, req.user?.id ?? 'system');
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('active')
  getActiveVersion(@Query('policyName') policyName?: string) {
    return this.policyCenterService.getActivePolicySnapshot(policyName);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('compare')
  compareVersions(
    @Query('fromVersionId') fromVersionId: string,
    @Query('toVersionId') toVersionId: string,
  ) {
    return this.policyCenterService.compareVersions(fromVersionId, toVersionId);
  }

  /**
   * POST /policy-center/versions/:id/replay
   * Re-evaluate a historical decision using the archived policy snapshot.
   * Returns archived rules, current rules, and a structured drift report (Issue #618).
   */
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post('versions/:id/replay')
  replayVersion(@Param('id') id: string) {
    return this.replayService.replay(id);
  }
}
