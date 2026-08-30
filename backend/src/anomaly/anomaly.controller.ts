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

@ApiTags('Anomalies')
@ApiBearerAuth()
@Controller('anomalies')
export class AnomalyController {
  constructor(
    private readonly anomalyService: AnomalyService,
    private readonly scoringService: AnomalyScoringService,
    private readonly driftService: AnomalyDriftService,
  ) {}

  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  @RequirePermissions(Permission.ADMIN_ACCESS)
  findAll(@Query(new ValidationPipe({ transform: true })) query: QueryAnomaliesDto) {
    return this.anomalyService.findAll(query);
  }

  @ApiOperation({ summary: 'Get :id' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.anomalyService.findOne(id);
  }

  @ApiOperation({ summary: 'Patch :id review' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
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
  @ApiOperation({ summary: 'Post run pipeline' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('run-pipeline')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  async runPipeline() {
    await this.scoringService.runPipeline();
    return { message: 'Pipeline triggered' };
  }

  // ── Drift detection endpoints ────────────────────────────────────────────

  /** Manually trigger drift evaluation for a model version */
  @ApiOperation({ summary: 'Post drift evaluate' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('drift/evaluate')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  async evaluateDrift(@Body() body: { modelVersion?: string }) {
    return this.driftService.evaluateDrift(body.modelVersion ?? '1.0.0');
  }

  /** Register a baseline distribution snapshot */
  @ApiOperation({ summary: 'Post drift baseline' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('drift/baseline')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  registerBaseline(@Body() baseline: FeatureBaseline) {
    this.driftService.registerBaseline(baseline);
    return { message: 'Baseline registered' };
  }

  /** Get drift report for governance/clinical review */
  @ApiOperation({ summary: 'Get drift report' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('drift/report')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  getDriftReport(@Query('modelVersion') modelVersion?: string) {
    return this.driftService.getDriftReport(modelVersion);
  }

  /** Shadow/canary scoring comparison */
  @ApiOperation({ summary: 'Post drift shadow compare' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
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
