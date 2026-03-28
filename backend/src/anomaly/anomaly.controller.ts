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
import { QueryAnomaliesDto } from './dto/query-anomalies.dto';
import { ReviewAnomalyDto } from './dto/review-anomaly.dto';

@Controller('anomalies')
export class AnomalyController {
  constructor(
    private readonly anomalyService: AnomalyService,
    private readonly scoringService: AnomalyScoringService,
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
}
