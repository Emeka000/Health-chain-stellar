import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { Request } from 'express';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';

import {
  AssignQuarantineReviewerDto,
  CreateQuarantineCaseDto,
  FinalizeQuarantineDto,
  QueryQuarantineCasesDto,
  UpdateQuarantineReviewDto,
} from '../dto/quarantine.dto';
import { QuarantineService } from '../services/quarantine.service';

@Controller('blood-units/quarantine')
export class QuarantineController {
  constructor(private readonly quarantineService: QuarantineService) {}

  @RequirePermissions(Permission.UPDATE_BLOOD_STATUS)
  @Post('cases')
  async createCase(
    @Body() dto: CreateQuarantineCaseDto,
    @Req() request: Request & { user?: { id: string; role: string } },
  ) {
    return this.quarantineService.createCase(dto, request.user);
  }

  @RequirePermissions(Permission.VIEW_BLOOD_STATUS_HISTORY)
  @Get('cases')
  async listCases(@Query() query: QueryQuarantineCasesDto) {
    return this.quarantineService.listCases(query);
  }

  @RequirePermissions(Permission.VIEW_BLOOD_STATUS_HISTORY)
  @Get('cases/:caseId/recommendation')
  async getRecommendation(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.quarantineService.getRecommendedDisposition(caseId);
  }

  @RequirePermissions(Permission.UPDATE_BLOOD_STATUS)
  @Patch('cases/:caseId/assign-reviewer')
  async assignReviewer(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: AssignQuarantineReviewerDto,
  ) {
    return this.quarantineService.assignReviewer(caseId, dto.reviewerAssignedTo);
  }

  @RequirePermissions(Permission.UPDATE_BLOOD_STATUS)
  @Patch('cases/:caseId/review')
  async updateReview(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: UpdateQuarantineReviewDto,
    @Req() request: Request & { user?: { id: string; role: string } },
  ) {
    return this.quarantineService.updateReview(caseId, dto, request.user);
  }

  @RequirePermissions(Permission.UPDATE_BLOOD_STATUS)
  @Patch('cases/:caseId/finalize')
  async finalizeCase(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: FinalizeQuarantineDto,
    @Req() request: Request & { user?: { id: string; role: string } },
  ) {
    return this.quarantineService.finalizeCase(caseId, dto, request.user);
  }
}
