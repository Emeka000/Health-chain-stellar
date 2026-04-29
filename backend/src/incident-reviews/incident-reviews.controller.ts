import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  ValidationPipe,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { CreateIncidentReviewDto } from './dto/create-incident-review.dto';
import { QueryIncidentReviewDto } from './dto/query-incident-review.dto';
import { UpdateIncidentReviewDto } from './dto/update-incident-review.dto';
import { CreateCorrectiveActionDto } from './dto/create-corrective-action.dto';
import { CompleteCorrectiveActionDto } from './dto/complete-corrective-action.dto';
import { VerifyCorrectiveActionDto } from './dto/verify-corrective-action.dto';
import { IncidentReviewsService } from './incident-reviews.service';

@Controller('incident-reviews')
export class IncidentReviewsController {
  constructor(private readonly service: IncidentReviewsService) { }

  @Post()
  @RequirePermissions(Permission.CREATE_INCIDENT_REVIEW)
  create(@Body() dto: CreateIncidentReviewDto, @Request() req: any) {
    return this.service.create(dto, req.user?.id ?? req.user?.sub ?? 'unknown');
  }

  @Get()
  @RequirePermissions(Permission.VIEW_INCIDENT_REVIEWS)
  findAll(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryIncidentReviewDto,
    @Request() req: any,
  ) {
    return this.service.findAll(query, {
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @Get('stats')
  @RequirePermissions(Permission.VIEW_INCIDENT_REVIEWS)
  getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('riderId') riderId?: string,
    @Query('hospitalId') hospitalId?: string,
    @Request() req?: any,
  ) {
    return this.service.getStats({
      startDate,
      endDate,
      riderId,
      hospitalId,
      actor: {
        userId: req?.user?.id ?? req?.user?.sub ?? 'unknown',
        role: req?.user?.role,
        organizationId: req?.user?.organizationId ?? null,
      },
    });
  }

  @Get('dashboard/open-risk')
  @RequirePermissions(Permission.VIEW_INCIDENT_REVIEWS)
  getOpenRiskDashboard(@Request() req: any) {
    return this.service.getOpenRiskDashboard({
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @Get('dashboard/action-completion-rates')
  @RequirePermissions(Permission.VIEW_INCIDENT_REVIEWS)
  getActionCompletionRates(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Request() req?: any,
  ) {
    return this.service.getActionCompletionRates({
      startDate,
      endDate,
      actor: {
        userId: req?.user?.id ?? req?.user?.sub ?? 'unknown',
        role: req?.user?.role,
        organizationId: req?.user?.organizationId ?? null,
      },
    });
  }

  @Get(':id')
  @RequirePermissions(Permission.VIEW_INCIDENT_REVIEWS)
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.service.findOne(id, {
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @Get(':id/corrective-actions')
  @RequirePermissions(Permission.VIEW_INCIDENT_REVIEWS)
  getCorrectiveActions(@Param('id') id: string) {
    return this.service.getCorrectiveActions(id);
  }

  @Get(':id/evidence-links')
  @RequirePermissions(Permission.VIEW_INCIDENT_REVIEWS)
  getEvidenceLinks(@Param('id') id: string) {
    return this.service.getEvidenceLinks(id);
  }

  @Post(':id/corrective-actions')
  @RequirePermissions(Permission.MANAGE_INCIDENT_REVIEWS)
  addCorrectiveAction(
    @Param('id') id: string,
    @Body() dto: CreateCorrectiveActionDto,
    @Request() req: any,
  ) {
    return this.service.addCorrectiveAction(id, dto, {
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @Patch('corrective-actions/:actionId/complete')
  @RequirePermissions(Permission.MANAGE_INCIDENT_REVIEWS)
  completeCorrectiveAction(
    @Param('actionId') actionId: string,
    @Body() dto: CompleteCorrectiveActionDto,
    @Request() req: any,
  ) {
    return this.service.completeCorrectiveAction(
      actionId,
      dto,
      req.user?.id ?? req.user?.sub ?? 'unknown',
    );
  }

  @Patch('corrective-actions/:actionId/verify')
  @RequirePermissions(Permission.MANAGE_INCIDENT_REVIEWS)
  verifyCorrectiveAction(
    @Param('actionId') actionId: string,
    @Body() dto: VerifyCorrectiveActionDto,
    @Request() req: any,
  ) {
    return this.service.verifyCorrectiveAction(
      actionId,
      dto,
      req.user?.id ?? req.user?.sub ?? 'unknown',
    );
  }

  @Post(':id/validate-closure')
  @RequirePermissions(Permission.MANAGE_INCIDENT_REVIEWS)
  validateClosure(@Param('id') id: string, @Request() req: any) {
    return this.service.validateClosure(
      id,
      req.user?.id ?? req.user?.sub ?? 'unknown',
      {
        userId: req.user?.id ?? req.user?.sub ?? 'unknown',
        role: req.user?.role,
        organizationId: req.user?.organizationId ?? null,
      },
    );
  }

  @Patch(':id')
  @RequirePermissions(Permission.MANAGE_INCIDENT_REVIEWS)
  update(@Param('id') id: string, @Body() dto: UpdateIncidentReviewDto, @Request() req: any) {
    return this.service.update(id, dto, {
      userId: req.user?.id ?? req.user?.sub ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }
}
