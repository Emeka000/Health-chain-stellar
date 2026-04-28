import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { User } from '../auth/decorators/user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { DonorEligibilityService } from './donor-eligibility.service';
import { CreateDeferralDto, OverrideDeferralDto, SimulateEligibilityDto } from './dto/create-deferral.dto';
import { EligibilityRuleVersionEntity } from './entities/eligibility-rule-version.entity';

@Controller('donor-eligibility')
export class DonorEligibilityController {
  constructor(private readonly service: DonorEligibilityService) {}

  @Get(':donorId')
  checkEligibility(@Param('donorId') donorId: string) {
    return this.service.checkEligibility(donorId);
  }

  @Get(':donorId/deferrals')
  getDeferrals(@Param('donorId') donorId: string) {
    return this.service.getDeferrals(donorId);
  }

  @Post('deferrals')
  createDeferral(@Body() dto: CreateDeferralDto, @User('id') userId: string) {
    return this.service.createDeferral(dto, userId);
  }

  /** Override deferral — requires approver identity and mandatory reason */
  @Post('deferrals/override')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  overrideDeferral(@Body() dto: OverrideDeferralDto, @User('id') approverId: string) {
    return this.service.overrideDeferral(dto, approverId);
  }

  @Delete('deferrals/:id')
  revokeDeferral(@Param('id') id: string) {
    return this.service.revokeDeferral(id);
  }

  /** Simulate eligibility decision for prospective policy changes */
  @Post('simulate')
  simulateEligibility(@Body() dto: SimulateEligibilityDto) {
    return this.service.simulateEligibility(dto);
  }

  // ── Rule version management ──────────────────────────────────────────────

  @Get('rules/versions')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  listRuleVersions(@Query('ruleKey') ruleKey?: string) {
    return this.service.listRuleVersions(ruleKey);
  }

  @Post('rules/versions')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  createRuleVersion(@Body() body: Partial<EligibilityRuleVersionEntity>, @User('id') userId: string) {
    return this.service.createRuleVersion(body, userId);
  }
}
