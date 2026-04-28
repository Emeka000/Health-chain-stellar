import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgTrustScoringService } from '../services/org-trust-scoring.service';

@ApiTags('Organization Trust Scores')
@Controller('organizations/:id/trust-score')
export class OrgTrustScoreController {
  constructor(private readonly svc: OrgTrustScoringService) {}

  /** Compute and store a new trust score for an organization */
  @Post()
  @ApiOperation({ summary: 'Compute and store trust score' })
  compute(@Param('id') id: string) {
    return this.svc.computeAndStore(id);
  }

  /** Get current trust score with per-factor explanation */
  @Get()
  @ApiOperation({ summary: 'Get current trust score with explanation' })
  getScore(@Param('id') id: string) {
    return this.svc.getScore(id);
  }

  /** Get full score history for backtesting */
  @Get('history')
  @ApiOperation({ summary: 'Get trust score history' })
  getHistory(@Param('id') id: string) {
    return this.svc.getHistory(id);
  }
}
