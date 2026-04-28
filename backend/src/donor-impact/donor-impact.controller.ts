import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { DonorImpactService } from './donor-impact.service';

@ApiTags('donor-impact')
@Controller('donor-impact')
export class DonorImpactController {
  constructor(private readonly donorImpactService: DonorImpactService) {}

  @RequirePermissions(Permission.VIEW_BLOODUNIT_TRAIL)
  @Get(':donorId')
  @ApiOperation({ summary: 'Get basic donor impact summary' })
  getDonorImpact(@Param('donorId', ParseUUIDPipe) donorId: string) {
    return this.donorImpactService.getDonorImpact(donorId);
  }

  @RequirePermissions(Permission.VIEW_BLOODUNIT_TRAIL)
  @Get(':donorId/attributed')
  @ApiOperation({ summary: 'Get full attributed impact report with causal lineage to outcomes' })
  @ApiResponse({ status: 200, description: 'Attribution report with confidence indicators and lineage gaps' })
  getAttributedImpact(@Param('donorId', ParseUUIDPipe) donorId: string) {
    return this.donorImpactService.getAttributedImpactReport(donorId);
  }

  @RequirePermissions(Permission.VIEW_BLOODUNIT_TRAIL)
  @Get('attribution/:correlationId/evidence')
  @ApiOperation({ summary: 'Drill-down evidence for a specific attribution correlation ID' })
  getDrillDownEvidence(@Param('correlationId') correlationId: string) {
    return this.donorImpactService.getDrillDownEvidence(correlationId);
  }

  @Get('public/:organizationId')
  @ApiOperation({ summary: 'Get public impact summary for an organization' })
  getPublicImpact(@Param('organizationId') organizationId: string) {
    return this.donorImpactService.getPublicImpactSummary(organizationId);
  }
}
