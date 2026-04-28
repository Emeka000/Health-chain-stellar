import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Request,
  ValidationPipe,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { AnomalyService } from './anomaly.service';
import { AnomalyScoringService } from './anomaly-scoring.service';
import { AnomalyDriftService, FeatureBaseline } from './anomaly-drift.service';
import { QueryAnomaliesDto } from './dto/query-anomalies.dto';
import { ReviewAnomalyDto } from './dto/review-anomaly.dto';

@Controller('anomalies')
export class AnomalyController {
  constructor(
    private readonly anomalyService: AnomalyService,
    private readonly scoringService: AnomalyScoringService,
    private readonly driftService: AnomalyDriftService,
  ) {}

  @Get()
  @RequirePermissions(Permission.ADMIN_ACCESS)
  findAll(@Query(new ValidationPipe({ transform: true })) query: QueryAnomaliesDto) {
    return this.anomalyService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.anomalyService.findOne(id);
  }

  @Patch(':id/review')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ValidationPipe()) dto: ReviewAnomalyDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.anomalyService.review(id, dto, req.user.sub);
  }

  /** Manually trigger the scoring pipeline (admin use) */
  @Post('run-pipeline')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  async runPipeline() {
    await this.scoringService.runPipeline();
    return { message: 'Pipeline triggered' };
  }

  // ── Drift detection endpoints ────────────────────────────────────────────

  /** Manually trigger drift evaluation for a model version */
  @Post('drift/evaluate')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  async evaluateDrift(@Body() body: { modelVersion?: string }) {
    return this.driftService.evaluateDrift(body.modelVersion ?? '1.0.0');
  }

  /** Register a baseline distribution snapshot */
  @Post('drift/baseline')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  registerBaseline(@Body() baseline: FeatureBaseline) {
    this.driftService.registerBaseline(baseline);
    return { message: 'Baseline registered' };
  }

  /** Get drift report for governance/clinical review */
  @Get('drift/report')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  getDriftReport(@Query('modelVersion') modelVersion?: string) {
    return this.driftService.getDriftReport(modelVersion);
  }

  /** Shadow/canary scoring comparison */
  @Post('drift/shadow-compare')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  shadowCompare(
    @Body() body: {
      currentScores: number[];
      candidateScores: number[];
      currentModelVersion: string;
      candidateModelVersion: string;
    },
  ) {
    return this.driftService.compareShadowScoring(
      body.currentScores,
      body.candidateScores,
      body.currentModelVersion,
      body.candidateModelVersion,
    );
  }
}
