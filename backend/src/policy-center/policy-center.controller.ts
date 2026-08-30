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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { CreatePolicyVersionDto } from './dto/create-policy-version.dto';
import { ListPolicyVersionsDto } from './dto/list-policy-versions.dto';
import { UpdatePolicyVersionDto } from './dto/update-policy-version.dto';
import { PolicyCenterService } from './policy-center.service';
import { PolicyReplayService } from './policy-replay.service';

@ApiTags('Policy Center')
@ApiBearerAuth()
@Controller('policy-center')
export class PolicyCenterController {
  constructor(
    private readonly policyCenterService: PolicyCenterService,
    private readonly replayService: PolicyReplayService,
  ) {}

  @ApiOperation({ summary: 'List all policy versions' })
  @ApiResponse({ status: 200, description: 'List of policy versions' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('versions')
  listVersions(@Query() query: ListPolicyVersionsDto) {
    return this.policyCenterService.listVersions(query);
  }

  @ApiOperation({ summary: 'Get a policy version by ID' })
  @ApiResponse({ status: 200, description: 'Policy version record' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('versions/:id')
  getVersion(@Param('id') id: string) {
    return this.policyCenterService.getVersion(id);
  }

  @ApiOperation({ summary: 'Create a new policy version' })
  @ApiResponse({ status: 201, description: 'Policy version created' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post('versions')
  createVersion(@Body() dto: CreatePolicyVersionDto, @Req() req: { user?: { id?: string } }) {
    return this.policyCenterService.createVersion(dto, req.user?.id ?? 'system');
  }

  @ApiOperation({ summary: 'Update a policy version' })
  @ApiResponse({ status: 200, description: 'Policy version updated' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Patch('versions/:id')
  updateVersion(@Param('id') id: string, @Body() dto: UpdatePolicyVersionDto) {
    return this.policyCenterService.updateVersion(id, dto);
  }

  @ApiOperation({ summary: 'Activate a policy version' })
  @ApiResponse({ status: 201, description: 'Policy version activated' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post('versions/:id/activate')
  activateVersion(@Param('id') id: string, @Req() req: { user?: { id?: string } }) {
    return this.policyCenterService.activateVersion(id, req.user?.id ?? 'system');
  }

  @ApiOperation({ summary: 'Rollback to a policy version' })
  @ApiResponse({ status: 201, description: 'Rolled back to policy version' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post('versions/:id/rollback')
  rollbackVersion(@Param('id') id: string, @Req() req: { user?: { id?: string } }) {
    return this.policyCenterService.rollbackToVersion(id, req.user?.id ?? 'system');
  }

  @ApiOperation({ summary: 'Get active policy snapshot' })
  @ApiResponse({ status: 200, description: 'Active policy snapshot' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('active')
  getActiveVersion(@Query('policyName') policyName?: string) {
    return this.policyCenterService.getActivePolicySnapshot(policyName);
  }

  @ApiOperation({ summary: 'Compare two policy versions' })
  @ApiResponse({ status: 200, description: 'Diff between policy versions' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('compare')
  compareVersions(
    @Query('fromVersionId') fromVersionId: string,
    @Query('toVersionId') toVersionId: string,
  ) {
    return this.policyCenterService.compareVersions(fromVersionId, toVersionId);
  }

  @ApiOperation({ summary: 'Replay a historical decision against an archived policy snapshot' })
  @ApiResponse({ status: 201, description: 'Replay result with drift report' })
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post('versions/:id/replay')
  replayVersion(@Param('id') id: string) {
    return this.replayService.replay(id);
  }
}
