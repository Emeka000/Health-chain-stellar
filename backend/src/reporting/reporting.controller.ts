import {
  Controller,
  Get,
  Query,
  Res,
  HttpStatus,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportingService } from './reporting.service';
import type { ReportingFilterDto } from './reporting.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

@Controller('reporting')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('search')
  @RequirePermissions(Permission.READ_ANALYTICS)
  async search(@Query(new ValidationPipe({ transform: true })) filters: ReportingFilterDto) {
    return this.reportingService.search(filters);
  }

  @Get('summary')
  @RequirePermissions(Permission.READ_ANALYTICS)
  async getSummary(@Query(new ValidationPipe({ transform: true })) filters: ReportingFilterDto) {
    return this.reportingService.getSummary(filters);
  }

  @Get('export')
  @RequirePermissions(Permission.READ_ANALYTICS)
  async export(
    @Query(new ValidationPipe({ transform: true })) filters: ReportingFilterDto,
    @Res() res: Response,
  ) {
    const buffer = await this.reportingService.exportToExcel(filters);
    
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=report.xlsx',
      'Content-Length': buffer.length,
    });

    res.status(HttpStatus.OK).send(buffer);
  }
}
