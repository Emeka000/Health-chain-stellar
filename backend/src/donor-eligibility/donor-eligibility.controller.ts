import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '../auth/decorators/user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { DonorEligibilityService } from './donor-eligibility.service';
import { CreateDeferralDto, OverrideDeferralDto, SimulateEligibilityDto } from './dto/create-deferral.dto';
import { EligibilityRuleVersionEntity } from './entities/eligibility-rule-version.entity';

@ApiTags('Donor Eligibility')
@ApiBearerAuth()
@Controller('donor-eligibility')
export class DonorEligibilityController {
  constructor(private readonly service: DonorEligibilityService) {}

  @ApiOperation({ summary: 'Get :donorId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':donorId')
  checkEligibility(@Param('donorId') donorId: string) {
    return this.service.checkEligibility(donorId);
  }

  @ApiOperation({ summary: 'Get :donorId deferrals' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':donorId/deferrals')
  getDeferrals(@Param('donorId') donorId: string) {
    return this.service.getDeferrals(donorId);
  }

  @ApiOperation({ summary: 'Post deferrals' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('deferrals')
  createDeferral(@Body() dto: CreateDeferralDto, @User('id') userId: string) {
    return this.service.createDeferral(dto, userId);
  }

  /** Override deferral — requires approver identity and mandatory reason */
  @ApiOperation({ summary: 'Post deferrals override' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('deferrals/override')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  overrideDeferral(@Body() dto: OverrideDeferralDto, @User('id') approverId: string) {
    return this.service.overrideDeferral(dto, approverId);
  }

  @ApiOperation({ summary: 'Delete deferrals :id' })
  @ApiResponse({ status: 200, description: 'Resource deleted successfully' })
  @Delete('deferrals/:id')
  revokeDeferral(@Param('id') id: string) {
    return this.service.revokeDeferral(id);
  }

  /** Simulate eligibility decision for prospective policy changes */
  @ApiOperation({ summary: 'Post simulate' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('simulate')
  simulateEligibility(@Body() dto: SimulateEligibilityDto) {
    return this.service.simulateEligibility(dto);
  }

  // ── Rule version management ──────────────────────────────────────────────

  @ApiOperation({ summary: 'Get rules versions' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('rules/versions')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  listRuleVersions(@Query('ruleKey') ruleKey?: string) {
    return this.service.listRuleVersions(ruleKey);
  }

  @ApiOperation({ summary: 'Post rules versions' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('rules/versions')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  createRuleVersion(@Body() body: Partial<EligibilityRuleVersionEntity>, @User('id') userId: string) {
    return this.service.createRuleVersion(body, userId);
  }
}
