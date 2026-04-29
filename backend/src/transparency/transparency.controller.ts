import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { TransparencyService } from './transparency.service';

@ApiTags('Transparency')
@Controller('transparency')
export class TransparencyController {
  constructor(private readonly transparencyService: TransparencyService) { }

  /**
   * Public metrics — no auth required.
   * Returns aggregated, redacted operational data with no PHI/PII.
   * Kept for backwards compatibility; prefer /publish for full artifact.
   */
  @Public()
  @Get('metrics')
  @ApiOperation({ summary: 'Get public operational metrics (redacted, aggregated)' })
  getPublicMetrics() {
    return this.transparencyService.getPublicMetrics();
  }

  /**
   * Full transparency publication artifact.
   * Includes the redacted data payload AND provenance metadata
   * (transformation rules, suppressed buckets, payload digest).
   */
  @Public()
  @Get('publish')
  @ApiOperation({ summary: 'Get full transparency publication with provenance metadata' })
  publish() {
    return this.transparencyService.getPublicMetricsWithProvenance();
  }

  /**
   * Privacy review report — admin only.
   * Summarises the sensitive-field taxonomy, last publication stats,
   * suppressed buckets, and actionable recommendations.
   */
  @Get('privacy-review')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get periodic privacy review report (admin only)' })
  privacyReview() {
    return this.transparencyService.getPrivacyReviewReport();
  }
}
